# central-control（bjutcv-hub）

一个用 Node.js + Express 编写的多子程序中控台。

它只对外提供一个 HTTP 入口，负责统一启动、停止、展示和反向代理多个独立子程序。
子程序可以是 Node、Python、FastAPI，也可以运行在另一台服务器上并通过 SSH 接入。

当前部署版本在页面和包名中称为 `bjutcv-hub`，但仓库名和主要代码结构仍为
`central-control`。

更完整的部署、运维和 GitHub 协作说明见：

- [4090D 部署与 GitHub 使用指南](docs/4090D_GITHUB_GUIDE.md)

## 当前部署

| 项目 | 值 |
|---|---|
| GitHub 仓库 | `https://github.com/Chauncey-Jheng/central-control.git` |
| 默认分支 | `main` |
| 部署主机 | 4090D，内网 IP `172.19.27.227` |
| SSH 别名 | `frp_4090D`（`106.13.98.182:6023`，用户 `bjutcv`） |
| 项目路径 | `/home/bjutcv/data/zcx/central-control` |
| 服务 | `central-control.service`（systemd user service） |
| 监听 | `0.0.0.0:4020` |
| 公网入口 | `http://106.13.98.182:4020/` |
| 公网端口来源 | 4090D 上 `frpc` 将本机 `4020` 转发到百度云 `frps` |
| Node | `/usr/bin/node`，当前为 `v10.19.0` |

常用命令：

```bash
ssh frp_4090D
cd /home/bjutcv/data/zcx/central-control

systemctl --user status central-control.service
journalctl --user -u central-control.service -f
systemctl --user restart central-control.service
```

## 项目能力

- **统一入口**：所有子程序都通过主端口的 `/apps/:appId/` 访问。
- **进程管理**：在页面上启动、停止子程序，状态由主进程统一维护。
- **就绪探测**：轮询子程序端口，端口真正可连后才允许打开页面。
- **HTTP 反向代理**：保留请求体、上传流和响应流，支持 multipart。
- **WebSocket 代理**：单独处理 upgrade 请求，支持实时流式页面。
- **子路径适配**：向 HTML 注入 `window.__APP_BASE__`，让子程序知道自己挂载在
  `/apps/:appId/` 下。
- **跨服务器接入**：通过 SSH + `ProxyJump` + 本地端口转发管理远程子程序。
- **热重载注册表**：`POST /api/reload` 重新读取 `apps.config.js`，无需重启中控。

## 架构

```text
浏览器
  │  http://106.13.98.182:4020/
  ▼
百度云 frps
  │  proxy: central_control_4020
  ▼
4090D frpc
  │  127.0.0.1:4020
  ▼
central-control server.js
  ├── /apps/satellite/        -> 127.0.0.1:4003
  ├── /apps/pcrl-mrg/         -> 127.0.0.1:8700
  ├── /apps/fault-diagnosis/  -> 127.0.0.1:8600 -> SSH -> 172.21.13.32:8600
  └── /apps/jaz-caption/      -> 127.0.0.1:7860 -> SSH -> 172.21.13.32:7860
```

核心文件：

- `server.js`：HTTP API、子程序生命周期、反向代理、就绪探测、优雅退出。
- `apps.config.js`：子程序注册表。
- `load-env.js`：极简 `.env` 读取器。
- `public/`：中控自己的前端，无构建步骤。
- `child-apps/`：各子程序的启动脚本和包装脚本。
- `satellite/`：卫星分析仓库的 git submodule。

## 目录结构

```text
central-control/
├── server.js
├── apps.config.js
├── load-env.js
├── package.json
├── public/
│   ├── index.html
│   └── main.js
├── child-apps/
│   ├── 2048/
│   ├── app-2/
│   ├── app-3/
│   ├── satellite/
│   ├── fault-diagnosis/
│   ├── jaz-caption/
│   ├── pcrl-mrg/
│   └── lib/remote-ssh-child.js
├── satellite/                   # git submodule
├── docs/
│   └── 4090D_GITHUB_GUIDE.md
├── README.md
└── CLAUDE.md
```

早期还存在一个 `child-app/`（单数）目录，它是单个子程序的示例，没有被注册到中控。
该目录已在提交 `6d0235f` 中删除。

## 当前子程序

当前 4090D 部署版的 `apps.config.js` 注册了 4 个子程序：

| ID | 名称 | 位置 | 端口 | 作者 | 启动方式 |
|---|---|---|---|---|---|
| `satellite` | 卫星遥测分析智能体 | 4090D 本机 | `4003` | 郑诚信 | Node 包装 + uvicorn |
| `fault-diagnosis` | 故障检测智能体 | `172.21.13.32` | `8600` | 郭元祯 | SSH + 本地端口转发 |
| `jaz-caption` | Caption 可解释性展示系统 | `172.21.13.32` | `7860` | 郭元祯 | SSH + 本地端口转发 |
| `pcrl-mrg` | 脑CT报告生成推理系统 | 4090D 本机 | `8700` | 郑诚信 | Node 包装 + uvicorn |

以下示例目录仍然保留，但当前部署没有注册：

| 目录 | 默认端口 | 说明 |
|---|---|---|
| `child-apps/2048` | `4000` | 2048 小游戏 |
| `child-apps/app-2` | `4001` | 示例 App 2 |
| `child-apps/app-3` | `4002` | 示例 App 3 |

## 快速开始（本地）

### 1. 克隆仓库

```bash
git clone --recurse-submodules https://github.com/Chauncey-Jheng/central-control.git
cd central-control
```

如果已经克隆但子模块为空：

```bash
git submodule update --init --recursive
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

本地默认可以使用：

```env
HOST=0.0.0.0
PORT=3000
CHILD_HOST=0.0.0.0
CHILD_BASE_PORT=4000
```

4090D 部署使用 `PORT=4020`，因此公网入口是 `http://106.13.98.182:4020/`。

### 4. 启动

```bash
npm start
# 等价于 node server.js
```

访问：

```text
http://<主机IP>:<PORT>/
```

## 子程序注册表

`apps.config.js` 导出一个数组。每一项可以是脚本路径字符串，也可以是对象：

```js
module.exports = [
  {
    id: 'app-4',
    name: 'App 4',
    script: './child-apps/app-4/server.js',
    port: 4004,
    host: '0.0.0.0',
    proxyTarget: '127.0.0.1',
    lanHost: '172.19.27.227',
    author: '作者名',
  },
];
```

常用字段：

| 字段 | 说明 |
|---|---|
| `id` | 唯一 ID，也是 URL 中的 `/apps/:appId/` |
| `name` | 页面展示名称 |
| `script` | 启动脚本路径，相对仓库根目录 |
| `port` | 子程序端口；未指定时按 `CHILD_BASE_PORT + index` 递增 |
| `host` | 子程序绑定地址，默认取 `CHILD_HOST` |
| `proxyTarget` | 中控实际连接地址，默认 `127.0.0.1` |
| `lanHost` | 页面展示用内网 IP；跨服务器子程序需要显式指定 |
| `author` | 页面卡片展示的作者 |

## 新增子程序

### Node 子程序

子程序只需要读取 `CHILD_HOST` 和 `CHILD_PORT`，并在该端口监听：

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

然后在 `apps.config.js` 中登记，最后执行：

```bash
curl -X POST http://127.0.0.1:4020/api/reload
```

或点击页面上的“重载子程序配置”。

### Python 子程序

参考 `child-apps/satellite/server.js` 和 `child-apps/pcrl-mrg/server.js`：

- Node 包装脚本读取 `CHILD_HOST/CHILD_PORT`；
- spawn 真正的 Python/uvicorn 进程；
- 转发 stdout/stderr；
- 把 `SIGTERM/SIGINT` 转发给 Python 子进程。

### 跨服务器子程序

参考 `child-apps/fault-diagnosis/server.js` 和
`child-apps/jaz-caption/server.js`，使用共享模块：

```js
const { spawnRemoteChild } = require('../lib/remote-ssh-child');
```

远端命令必须：

1. 先输出 `REMOTE_PID:<pid>`；
2. 最后用 `exec` 启动真正的程序。

这样停止时才能精确 kill 远端进程，避免隧道断开后远端进程变成孤儿。

## 热重载语义

`POST /api/reload` 会重新读取 `apps.config.js`，按 `id` 对账：

- 新增的应用：加入列表；
- 删除的应用：先停止进程，再移除；
- `script/port/host/proxyTarget` 变化的应用：停止旧进程，等待手动重新启动；
- 仅名称、作者等展示字段变化的应用：不打断运行中的进程。

## 环境变量

| 变量 | 说明 |
|---|---|
| `HOST` | 中控绑定地址，默认 `0.0.0.0` |
| `PORT` | 中控端口，本地默认 `3000`，4090D 部署为 `4020` |
| `CHILD_HOST` | 子程序默认绑定地址 |
| `CHILD_BASE_PORT` | 未显式指定端口的子程序起始端口 |
| `LAN_HOST` | 可选，页面展示本机子程序时使用的内网 IP |
| `SATELLITE_ROOT` | 卫星仓库根目录 |
| `SATELLITE_PYTHON` | 卫星 App 的 Python 解释器 |
| `PCRL_MRG_ROOT` | PCRL-MRG 仓库根目录 |
| `PCRL_MRG_PYTHON` | PCRL-MRG 的 Python 解释器 |
| `DEEPSEEK_API_KEY` | 可选，Agent/LLM 接入 |
| `OPENAI_API_KEY` | 可选，Agent/LLM 接入 |
| `DASHSCOPE_API_KEY` | 可选，Agent/LLM 接入 |

`.env` 已被 `.gitignore` 忽略，不要提交任何真实密钥。

## API

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

`GET /api/apps` 中：

- `running`：进程是否存在；
- `ready`：端口是否真正可连；
- `pid`：子进程 PID；
- `url`：就绪后的访问地址，未就绪时为 `null`；
- `error`：子程序退出错误。

## GitHub 协作

当前推荐流程：

1. 在本地修改、提交并推送到 GitHub；
2. 登录 4090D，执行 `git pull --ff-only origin main`；
3. 重启服务或热重载配置。

```bash
# 本地
git add <files>
git commit -m "说明这次改动"
git push origin main

# 4090D
ssh frp_4090D
cd /home/bjutcv/data/zcx/central-control
git pull --ff-only origin main
```

4090D 当前没有 GitHub push 凭据，直接 `git push` 会失败。需要从服务器推送时，
请参考详细文档中的 Deploy Key 配置。不要在远端 URL 中拼接 token。

## 注意事项

- 子程序运行状态只保存在内存中，中控重启后会忘记之前运行了哪些子程序。
- 中控收到 `SIGTERM/SIGINT` 时会清理自己拉起的子程序；不要使用 `kill -9`。
- 4090D 使用 systemd 的 `KillMode=control-group`，停止服务会一并清理 cgroup 内的子程序。
- 如果中控异常退出，子程序可能成为孤儿进程并占用端口，需要手动检查。
- `child-apps/2048`、`app-2`、`app-3` 当前未注册，不会出现在部署页面。
- 4090D 当前 Node 版本为 `v10.19.0`，已停止维护；新增现代语法前需要先确认兼容性。
- 仓库目前没有 lint/test/build 脚本，修改后至少执行：

```bash
node --check server.js
node -e "require('./apps.config'); console.log('apps.config ok')"
```

- 公网只应暴露中控主端口，子程序端口保持内网访问。

## 相关文档

- [4090D 部署与 GitHub 使用指南](docs/4090D_GITHUB_GUIDE.md)
- [CLAUDE.md](CLAUDE.md)
- [satellite 子模块说明](satellite/README.md)
