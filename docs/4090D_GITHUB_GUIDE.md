# central-control（bjutcv-hub）使用指南

本文档说明 `central-control` 仓库的定位、架构和日常使用方式，以及它在
4090D 服务器上的部署、运维和 GitHub 协作流程。

> 最后核对时间：2026-11-19  
> 适用范围：GitHub 仓库 `Chauncey-Jheng/central-control`、4090D 部署环境  
> 文档性质：内部运维文档，包含内网 IP、端口和部署路径；对外分享前请先确认脱敏范围。

## 0. 快速信息

| 项目 | 值 |
|---|---|
| GitHub 仓库 | `https://github.com/Chauncey-Jheng/central-control.git` |
| 默认分支 | `main` |
| 部署主机 | 4090D，内网 IP `172.19.27.227` |
| SSH 别名 | `frp_4090D` |
| SSH 实际入口 | `106.13.98.182:6023`，用户 `bjutcv` |
| 项目路径 | `/home/bjutcv/data/zcx/central-control` |
| 服务名 | `central-control.service`（systemd user service） |
| 服务监听 | `0.0.0.0:4020` |
| 公网访问 | `http://106.13.98.182:4020/` |
| frp 出口 | 百度云服务器 `frps`，4090D 上 `frpc` |
| 当前运行时 | Node.js `v10.19.0`，npm `6.14.4` |
| 文档编写时 HEAD | `6d0235f 移除未使用的 child-app 示例目录` |

登录 4090D：

```bash
ssh frp_4090D
```

进入项目：

```bash
cd /home/bjutcv/data/zcx/central-control
```

查看服务状态：

```bash
systemctl --user status central-control.service
```

## 1. 项目定位

`central-control` 是一个用 Node.js + Express 编写的“多子程序中控台”。
它本身只对外提供一个 HTTP 入口，负责：

1. 读取子程序注册表；
2. 启动、停止子程序进程；
3. 检查子程序端口是否真正就绪；
4. 通过 `/apps/:appId/` 反向代理子程序的 HTTP 和 WebSocket 请求；
5. 在一个页面上展示所有子程序的名称、作者、端口、运行状态和访问地址。

项目最初叫 `central-control`，部署到 4090D 后页面和包名改为 `bjutcv-hub`，
但仓库名、目录名和主要代码结构没有变化。

它解决的问题是：多个独立应用使用不同语言、不同框架、不同端口，如果每个都单独
暴露到公网，端口管理和安全暴露面会变得很复杂。中控把这些应用统一挂到同一个入口下，
对外只需要暴露一个端口。

## 2. 整体架构

### 2.1 公网访问链路

```text
浏览器
  │  http://106.13.98.182:4020/
  ▼
百度云服务器 frps
  │  公网 4020
  │  proxy 名：central_control_4020
  ▼
4090D 上的 frpc
  │  localIP = 127.0.0.1
  │  localPort = 4020
  ▼
central-control server.js
  │  0.0.0.0:4020
  ├── /apps/satellite/        -> 127.0.0.1:4003
  ├── /apps/pcrl-mrg/         -> 127.0.0.1:8700
  ├── /apps/fault-diagnosis/  -> 127.0.0.1:8600 -> SSH -> 172.21.13.32:8600
  └── /apps/jaz-caption/      -> 127.0.0.1:7860 -> SSH -> 172.21.13.32:7860
```

关键点：

- 公网只暴露百度云服务器的 `4020` 端口。
- 4090D 上的 `central-control` 自己监听 `4020`，不是监听默认的 `3000`。
- 子程序端口默认只在内网可达，公网访问统一走 `/apps/:appId/`。
- `fault-diagnosis` 和 `jaz-caption` 不在 4090D 本机，而是通过 SSH 跳板和端口转发接入。

### 2.2 frp 配置

4090D 上的 frpc：

- 服务：`frpc.service`
- 配置文件：`/etc/frp/frpc.toml`
- 连接地址：`106.13.98.182:7001`
- 代理 1：`ssh_4090D`，本机 `22` -> 公网 `6023`
- 代理 2：`central_control_4020`，本机 `4020` -> 公网 `4020`

百度云服务器上的 frps：

- 服务：`frps.service`
- 配置：`/usr/local/etc/frp/frps.toml`
- 监听：`7001`

如果公网 `4020` 不通，需要同时检查百度云的 `frps` 和 4090D 的 `frpc`。

### 2.3 中控内部请求流

1. 浏览器访问 `http://<host>:4020/`，拿到中控自己的静态页面。
2. 页面每 2 秒请求 `GET /api/apps` 刷新状态。
3. 点击“启动”时请求 `POST /api/apps/:appId/start`。
4. 中控用 `node <scriptPath>` 拉起子程序，并注入：
   - `CHILD_HOST`
   - `CHILD_PORT`
   - `CHILD_APP_ID`
   - `CHILD_APP_NAME`
5. 中控轮询子程序端口，能建立 HTTP 连接后才把 `ready` 置为 `true`。
6. 页面只有看到 `ready=true` 才允许点击“打开页面”。
7. 打开页面后，请求进入 `/apps/:appId/`，由 `http-proxy` 转发到子程序。
8. WebSocket 升级请求不经过 Express 中间件，而是在 `server.on('upgrade')` 中单独转发。

## 3. 核心机制

### 3.1 子程序注册表

注册表文件是 `apps.config.js`，导出一个数组。每一项可以是：

- 一个脚本路径字符串；
- 或一个对象，常用字段如下：

| 字段 | 说明 |
|---|---|
| `id` | 唯一 ID，也是 URL 中的 `/apps/:appId/` |
| `name` | 页面展示名称 |
| `script` | 启动脚本路径，相对仓库根目录 |
| `port` | 子程序端口；未指定时按 `CHILD_BASE_PORT + index` 递增 |
| `host` | 子程序绑定地址，默认取 `CHILD_HOST` |
| `proxyTarget` | 中控实际连接地址，默认 `127.0.0.1` |
| `lanHost` | 页面展示用的内网 IP，跨服务器子程序需要显式指定 |
| `author` | 页面卡片展示的作者 |

### 3.2 生命周期与状态

运行状态保存在内存里的 `childRuntimes` Map 中，不落盘。

这意味着：

- 重启中控后，之前哪些子程序在运行不会被记住；
- 中控退出时会主动杀掉自己拉起的子程序；
- 如果中控被 `kill -9`，子程序可能变成孤儿进程，继续占用端口。

当前服务使用 systemd 的 `KillMode=control-group`，停止服务时会连同子程序一起清理。

### 3.3 就绪探测

中控不是简单看进程是否存活，而是每 1.5 秒探测一次子程序端口。

只要端口能建立连接并返回任意 HTTP 响应，就认为子程序已经就绪。这样设计是因为：

- 有些子程序启动后还要加载几 GB 模型；
- 进程已经存在但端口还没监听时，用户点进去会白屏或连接被拒；
- 只要端口真正可连，跳转过去才有意义。

页面上的三种状态：

- `未启动`：没有存活进程；
- `启动中…`：进程存在但端口还不可连；
- `运行中`：端口已可连，可以打开页面。

### 3.4 反向代理与子路径适配

所有子程序都通过：

```text
/apps/<appId>/
```

访问。

代理时会：

- 强制补尾部斜杠，保证相对资源路径正确；
- 在 HTML 响应里注入：

```html
<script>window.__APP_BASE__="/apps/<appId>/";</script>
```

子程序前端可以读取这个变量，处理自己被挂在子路径下的情况。

### 3.5 热重载注册表

部署版新增了：

```text
POST /api/reload
```

它会重新读取 `apps.config.js`，按 `id` 和当前配置对账：

- 新增的应用：加入列表；
- 删除的应用：先停止进程，再移除；
- `script/port/host/proxyTarget` 变化的应用：停止旧进程，等待手动重新启动；
- 仅名称、作者等展示字段变化的应用：不打断运行中的进程。

页面上的“↻ 重载子程序配置”按钮就是调用这个接口。

## 4. 仓库结构

```text
central-control/
├── server.js                    # 中控主程序：API、生命周期、代理、就绪探测
├── apps.config.js               # 子程序注册表
├── load-env.js                  # 极简 .env 读取器
├── package.json                 # 根项目依赖
├── public/                      # 中控自己的前端
│   ├── index.html
│   └── main.js
├── child-apps/                  # 子程序集合
│   ├── 2048/                    # 示例：2048 小游戏
│   ├── app-2/                   # 示例：App 2
│   ├── app-3/                   # 示例：App 3
│   ├── satellite/               # FY3F 卫星遥测分析，Python 包装脚本
│   ├── fault-diagnosis/         # 远程故障检测智能体，SSH 包装脚本
│   ├── jaz-caption/             # 远程 Caption 可解释性展示，SSH 包装脚本
│   ├── pcrl-mrg/                # 脑CT报告生成推理系统，Python 包装脚本
│   └── lib/remote-ssh-child.js  # 跨服务器子程序共享 SSH 启动逻辑
├── satellite/                   # git submodule：卫星分析仓库
├── docs/                        # 项目文档
├── README.md
└── CLAUDE.md
```

说明：

- 早期还有一个 `child-app/`（单数）目录，是单个子程序的示例，未注册到中控。
  该目录已在提交 `6d0235f` 中删除。
- `child-apps/2048`、`child-apps/app-2`、`child-apps/app-3` 的代码仍然保留，
  但当前部署版 `apps.config.js` 没有注册它们。
- `satellite/` 是 git submodule，对应独立仓库：
  `https://github.com/Chauncey-Jheng/satellite.git`。

## 5. 当前部署的子程序

当前 4090D 部署版的 `apps.config.js` 注册了 4 个子程序：

| ID | 名称 | 位置 | 端口 | 作者 | 启动方式 |
|---|---|---|---|---|---|
| `satellite` | 卫星遥测分析智能体 | 4090D 本机 | `4003` | 郑诚信 | Node 包装 + uvicorn |
| `fault-diagnosis` | 故障检测智能体 | `172.21.13.32` | `8600` | 郭元祯 | SSH + 本地端口转发 |
| `jaz-caption` | Caption 可解释性展示系统 | `172.21.13.32` | `7860` | 郭元祯 | SSH + 本地端口转发 |
| `pcrl-mrg` | 脑CT报告生成推理系统 | 4090D 本机 | `8700` | 郑诚信 | Node 包装 + uvicorn |

### 5.1 satellite

- 注册表脚本：`./child-apps/satellite/server.js`
- 实际程序：`app.backend.main:app`（FastAPI + uvicorn）
- 工作目录：`/home/bjutcv/data/zcx/central-control/satellite`
- Python：
  `/home/bjutcv/anaconda3/envs/satellite/bin/python`
- 公网地址：
  `http://106.13.98.182:4020/apps/satellite/`

### 5.2 pcrl-mrg

- 注册表脚本：`./child-apps/pcrl-mrg/server.js`
- 实际程序：`server:app`（FastAPI + uvicorn）
- 工作目录：`/home/bjutcv/data/zcx/PCRL-MRG/inference`
- Python：
  `/home/bjutcv/anaconda3/envs/zcx_llama/bin/python`
- 公网地址：
  `http://106.13.98.182:4020/apps/pcrl-mrg/`

### 5.3 fault-diagnosis

- 注册表脚本：`./child-apps/fault-diagnosis/server.js`
- 远程主机：`bjutcv@172.21.13.32`
- 跳板机：`bjutcv@172.19.27.89`
- 远程命令：
  `source ~/anaconda3/etc/profile.d/conda.sh && cd /home/bjutcv/data/guoyuanzhen/fault_diagnosis && exec bash webui/run_webui.sh`
- 本地转发端口：`8600`

### 5.4 jaz-caption

- 注册表脚本：`./child-apps/jaz-caption/server.js`
- 远程主机：`bjutcv@172.21.13.32`
- 跳板机：`bjutcv@172.19.27.89`
- 远程命令：
  `source ~/anaconda3/etc/profile.d/conda.sh && conda activate jaz && cd /home/bjutcv/data/guoyuanzhen/jaz_scale && exec python caption_explain_web.py --host 0.0.0.0 --port 7860`
- 本地转发端口：`7860`

### 5.5 未注册的示例

以下目录仍然存在，但当前部署没有把它们放进注册表：

| 目录 | 默认端口 | 说明 |
|---|---|---|
| `child-apps/2048` | `4000` | 2048 小游戏 |
| `child-apps/app-2` | `4001` | 示例 App 2 |
| `child-apps/app-3` | `4002` | 示例 App 3 |

如果要恢复，只需在 `apps.config.js` 中重新加入对应条目，然后点击页面上的
“重载子程序配置”或重启服务。

## 6. 4090D 部署详情

### 6.1 主机与路径

| 项目 | 值 |
|---|---|
| 主机名 | `bjutcv-System-Product-Name` |
| 内网 IP | `172.19.27.227` |
| 登录用户 | `bjutcv` |
| 项目目录 | `/home/bjutcv/data/zcx/central-control` |
| 系统 | Ubuntu 20.04.6 LTS |
| Node | `/usr/bin/node`，版本 `v10.19.0` |
| npm | `6.14.4` |

### 6.2 systemd user service

服务文件位置：

```text
/home/bjutcv/.config/systemd/user/central-control.service
```

内容：

```ini
[Unit]
Description=Central Control Hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/bjutcv/data/zcx/central-control
ExecStart=/usr/bin/node /home/bjutcv/data/zcx/central-control/server.js
Restart=on-failure
RestartSec=5s
KillMode=control-group
TimeoutStopSec=30s
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

该服务是 **systemd user service**，不是系统级服务。`bjutcv` 用户已开启 linger，
所以即使没有登录会话，服务也能继续运行并在开机后启动。

查看 linger：

```bash
loginctl show-user bjutcv -p Linger
# Linger=yes
```

### 6.3 环境变量

项目根目录的 `.env` 已被 `.gitignore` 忽略，不会提交到 GitHub。

当前部署的关键配置：

```env
HOST=0.0.0.0
PORT=4020

CHILD_HOST=0.0.0.0
CHILD_BASE_PORT=4000

SATELLITE_ROOT=/home/bjutcv/data/zcx/central-control/satellite
SATELLITE_PYTHON=/home/bjutcv/anaconda3/envs/satellite/bin/python

PCRL_MRG_ROOT=/home/bjutcv/data/zcx/PCRL-MRG
PCRL_MRG_PYTHON=/home/bjutcv/anaconda3/envs/zcx_llama/bin/python

# Agent / LLM 相关，值不要提交到仓库
DEEPSEEK_API_KEY=<redacted>
OPENAI_API_KEY=<redacted>
DASHSCOPE_API_KEY=<redacted>
```

注意：

- `.env` 修改后需要重启 `central-control.service` 才会生效。
- `.env` 含 API key，建议设置为仅本人可读：

```bash
chmod 600 /home/bjutcv/data/zcx/central-control/.env
```

### 6.4 检查监听端口

```bash
ss -lntp | grep -E ':(4020|4003|7860|8600|8700)\b'
```

正常情况下，`4020` 应该由 `node` 进程监听：

```text
LISTEN 0 511 0.0.0.0:4020 0.0.0.0:* users:(("node",pid=...,fd=...))
```

子程序端口只有在对应子程序启动并真正监听后才会出现。

## 7. 4090D 日常操作

### 7.1 登录与查看状态

```bash
ssh frp_4090D
cd /home/bjutcv/data/zcx/central-control

systemctl --user status central-control.service
ss -lntp | grep 4020
curl -s http://127.0.0.1:4020/api/apps
```

### 7.2 启动、停止、重启

```bash
systemctl --user start central-control.service
systemctl --user stop central-control.service
systemctl --user restart central-control.service
```

因为 unit 配置了：

```ini
KillMode=control-group
```

停止或重启中控时，cgroup 里的子程序也会被一起清理。

### 7.3 查看日志

实时日志：

```bash
journalctl --user -u central-control.service -f
```

最近 200 行：

```bash
journalctl --user -u central-control.service -n 200 --no-pager
```

子程序日志会带 `[appId]` 前缀，例如：

```text
[satellite] ...
[pcrl-mrg] ...
```

项目目录下还有一个 `central-control.log`，它可能是早期手动启动时留下的文件；
当前 systemd 部署以 `journalctl` 为准。

### 7.4 修改代码后的生效方式

| 修改内容 | 生效方式 |
|---|---|
| `public/` 下的静态文件 | 刷新浏览器即可，必要时强制刷新 |
| `apps.config.js` | 调用 `POST /api/reload`，或重启服务 |
| `server.js`、`load-env.js` | 重启 `central-control.service` |
| `.env` | 重启 `central-control.service` |
| 子程序自己的代码 | 在页面上关闭并重新启动该子程序 |

### 7.5 重启 frp 隧道

frpc 是系统级服务，需要 root 权限：

```bash
sudo systemctl status frpc
sudo systemctl restart frpc
```

检查公网入口：

```bash
curl -I http://106.13.98.182:4020/
```

## 8. GitHub 协作

### 8.1 当前推荐流程

当前 4090D 上没有配置 GitHub push 凭据：

- `git fetch/pull` 可以正常使用；
- `git push` 会报：

```text
fatal: could not read Username for 'https://github.com': No such device or address
```

因此目前推荐：

1. 在本地开发机修改代码；
2. 本地提交并推送到 GitHub；
3. 登录 4090D，执行 `git pull --ff-only origin main` 同步；
4. 重启服务或热重载配置。

这和“在 4090D 直接改代码”相比更容易管理，也不会把 GitHub 凭据放到服务器上。

### 8.2 本地开发与推送

```bash
git status
git diff
git add <files>
git commit -m "说明这次改动"
git push origin main
```

推送前建议确认：

```bash
git diff --cached
git status
```

不要把 `.env`、API key、token、私钥或服务器密码加入提交。

### 8.3 4090D 同步

```bash
ssh frp_4090D
cd /home/bjutcv/data/zcx/central-control
git status
git pull --ff-only origin main
```

如果 `git pull` 提示本地有未提交改动，先确认这些改动是否要保留：

```bash
git diff
git status
```

4090D 当前还有一些未跟踪文件，例如：

```text
CLAUDE.md
apps.config.js.bak-20260720
server.js.bak-20260720
```

不要直接执行 `git add -A`，否则可能把备份文件一起提交。

### 8.4 在 4090D 上直接推送（可选）

如果确实需要从 4090D 直接 push，推荐使用只授权给本仓库的
GitHub Deploy Key，而不是把个人 token 写进远端 URL。

生成专用 key：

```bash
ssh-keygen -t ed25519 -C "4090d-central-control" \
  -f ~/.ssh/id_ed25519_central_control
```

把公钥内容添加到 GitHub：

```bash
cat ~/.ssh/id_ed25519_central_control.pub
```

在 GitHub 仓库的 `Settings -> Deploy keys` 中添加，并勾选
`Allow write access`。

配置 SSH：

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-central-control
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_central_control
  IdentitiesOnly yes
EOF
```

切换远端地址：

```bash
cd /home/bjutcv/data/zcx/central-control
git remote set-url origin git@github-central-control:Chauncey-Jheng/central-control.git
```

验证：

```bash
ssh -T git@github-central-control
```

注意：4090D 上已有的 `~/.ssh/id_ed25519` 不是这个仓库的 key，
不要复用它，也不要覆盖现有 key。

### 8.5 紧急情况下的代推方式

如果已经在 4090D 本地提交，但没有 push 凭据，可以临时从本地开发机代推：

在本地执行：

```bash
git fetch frp_4090D:/home/bjutcv/data/zcx/central-control main
git push origin <commit>:main
```

然后在 4090D 上刷新远端跟踪引用：

```bash
git fetch origin main
```

这只是应急方案，长期还是建议配置 Deploy Key 或 PAT。

## 9. 新增或修改子程序

### 9.1 新增本地 Node 子程序

在 `child-apps/` 下新建目录，例如：

```text
child-apps/app-4/server.js
```

最小实现需要读取 `CHILD_HOST` 和 `CHILD_PORT`：

```js
const express = require('express');

const app = express();
const host = process.env.CHILD_HOST || '0.0.0.0';
const port = Number(process.env.CHILD_PORT) || 4000;

app.get('/', (_req, res) => {
  res.send('app-4 running');
});

app.listen(port, host);
```

然后在 `apps.config.js` 中添加：

```js
{
  id: 'app-4',
  name: 'App 4',
  script: './child-apps/app-4/server.js',
  port: 4004,
  author: '作者名',
}
```

最后：

```bash
curl -X POST http://127.0.0.1:4020/api/reload
```

或在页面上点击“重载子程序配置”。

### 9.2 新增 Python 子程序

参考 `child-apps/satellite/server.js` 和 `child-apps/pcrl-mrg/server.js`：

- 用 Node 包装脚本读取 `CHILD_HOST/CHILD_PORT`；
- spawn 真正的 Python/uvicorn 进程；
- 转发 stdout/stderr；
- 把 `SIGTERM/SIGINT` 转发给 Python 子进程，避免孤儿进程。

### 9.3 新增跨服务器子程序

参考 `child-apps/fault-diagnosis/server.js` 和
`child-apps/jaz-caption/server.js`，使用共享模块：

```js
const { spawnRemoteChild } = require('../lib/remote-ssh-child');
```

需要提供：

- 跳板机用户和地址；
- 目标机用户和地址；
- 远端启动命令；
- 本地转发端口；
- 远端端口。

远端命令必须：

1. 先输出 `REMOTE_PID:<pid>`；
2. 最后用 `exec` 启动真正的程序。

这样停止时才能精确 kill 远端进程。

## 10. API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/apps` | 返回所有子程序状态 |
| `POST` | `/api/apps/:appId/start` | 启动指定子程序 |
| `POST` | `/api/apps/:appId/stop` | 停止指定子程序 |
| `POST` | `/api/reload` | 热重载 `apps.config.js` |
| `GET` | `/apps/:appId/` | 反向代理到子程序 |

示例：

```bash
curl -s http://127.0.0.1:4020/api/apps
curl -X POST http://127.0.0.1:4020/api/apps/satellite/start
curl -X POST http://127.0.0.1:4020/api/apps/satellite/stop
curl -X POST http://127.0.0.1:4020/api/reload
```

`GET /api/apps` 返回的关键字段：

| 字段 | 说明 |
|---|---|
| `running` | 进程是否存在 |
| `ready` | 端口是否真正可连 |
| `pid` | 子进程 PID |
| `url` | 就绪后的访问地址；未就绪时为 `null` |
| `error` | 子程序退出错误 |

## 11. 故障排查

### 11.1 公网 4020 打不开

按顺序检查：

```bash
# 1. 4090D 本机中控
ssh frp_4090D
systemctl --user status central-control.service
ss -lntp | grep 4020
curl -I http://127.0.0.1:4020/

# 2. 4090D 上的 frpc
sudo systemctl status frpc

# 3. 百度云上的 frps
ssh BaiduOpenClaw
systemctl status frps
ss -lntp | grep 4020
```

### 11.2 页面能打开，但子程序 502

常见原因：

- 子程序没有启动；
- 子程序进程存在但端口还没监听；
- 子程序启动失败后退出；
- 代理目标地址或端口配置错误。

查看：

```bash
curl -s http://127.0.0.1:4020/api/apps
journalctl --user -u central-control.service -n 200 --no-pager
ss -lntp | grep <子程序端口>
```

### 11.3 一直显示“启动中…”

说明进程存在，但端口还不可连。常见于：

- 大模型加载；
- Python 依赖初始化；
- GPU 显存不足；
- 子程序卡死。

检查：

```bash
journalctl --user -u central-control.service -f
ss -lntp | grep <子程序端口>
nvidia-smi
```

### 11.4 端口被占用

```bash
ss -lntp | grep <端口>
ps -eo pid,ppid,etime,cmd | grep <端口或脚本名>
```

优先通过重启中控清理：

```bash
systemctl --user restart central-control.service
```

因为 `KillMode=control-group` 会清理同一 cgroup 内的子程序。

### 11.5 远程子程序启动失败

先手动验证 SSH 和远端环境：

```bash
ssh -J bjutcv@172.19.27.89 bjutcv@172.21.13.32
```

登录后检查：

- conda 环境是否存在；
- 项目目录是否存在；
- 远端端口是否被占用；
- 启动脚本是否能手动运行。

### 11.6 GitHub push 失败

见第 8.4 节。当前 4090D 没有 push 凭据，直接 `git push` 会失败。

### 11.7 Node 版本问题

当前 4090D 使用 Node `v10.19.0`，已经停止维护。现有代码可以运行，
但如果新增了较新的 JavaScript 语法，可能在这个版本上解析失败。

升级 Node 前需要：

1. 先在测试环境验证 `node --check server.js`；
2. 验证 `npm install` 和子程序启动；
3. 更新 systemd 的 `ExecStart` 指向新解释器；
4. `systemctl --user daemon-reload`；
5. 重启服务并观察日志。

## 12. 安全与维护建议

- 公网只暴露 `4020`，不要额外暴露子程序端口。
- `.env` 含 API key，不要提交到 GitHub，建议权限设为 `600`。
- GitHub 凭据使用最小权限的 Deploy Key 或 fine-grained PAT。
- 不要把 token 拼进远端 URL，也不要写在脚本或文档里。
- 4090D 上的 `.bak-*` 文件属于本地备份，不要误提交。
- 修改 `server.js` 后先做语法检查：

```bash
node --check server.js
```

- 定期查看日志和磁盘：

```bash
journalctl --user -u central-control.service -n 100 --no-pager
df -h
```

## 13. 当前状态与已知问题

以下为 2026-11-19 编写文档时的观察结果，后续可能变化：

- `central-control.service` 处于 active/running 状态。
- `4020` 由 Node 进程监听。
- 服务自 2026-08-07 起持续运行。
- 4090D 上 `satellite` 的 Node 包装进程和 uvicorn 子进程仍然存在，
  但检查时 `4003` 端口没有监听，页面/API 可能显示未就绪。
- `fault-diagnosis`、`jaz-caption`、`pcrl-mrg` 历史上都出现过非 0 退出，
  具体错误以 `journalctl` 为准。
- 4090D 没有配置 GitHub push 凭据，推送需要走本地代推或配置 Deploy Key。
- 4090D 的 Node 版本为 `v10.19.0`，已停止维护。

如果要重新拉起 `satellite`，最直接的方式是：

```bash
systemctl --user restart central-control.service
```

然后在页面中点击 `satellite` 的“启动”。注意这会同时停止当前 cgroup 内的
所有子程序。

## 14. 常用命令速查

```bash
# 登录 4090D
ssh frp_4090D

# 进入项目
cd /home/bjutcv/data/zcx/central-control

# 服务状态 / 启停
systemctl --user status central-control.service
systemctl --user restart central-control.service
systemctl --user stop central-control.service
systemctl --user start central-control.service

# 日志
journalctl --user -u central-control.service -f

# 端口
ss -lntp | grep -E ':(4020|4003|7860|8600|8700)\b'

# API
curl -s http://127.0.0.1:4020/api/apps
curl -X POST http://127.0.0.1:4020/api/apps/satellite/start
curl -X POST http://127.0.0.1:4020/api/apps/satellite/stop
curl -X POST http://127.0.0.1:4020/api/reload

# GitHub 同步
git status
git pull --ff-only origin main

# 公网检查
curl -I http://106.13.98.182:4020/
```

## 15. 相关文件

- [`README.md`](../README.md)：仓库基础说明
- [`CLAUDE.md`](../CLAUDE.md)：面向 coding agent 的仓库约定
- [`apps.config.js`](../apps.config.js)：子程序注册表
- [`server.js`](../server.js)：中控主程序
- [`child-apps/lib/remote-ssh-child.js`](../child-apps/lib/remote-ssh-child.js)：跨服务器子程序封装
