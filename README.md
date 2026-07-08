# central-control

## 项目简介

`central-control` 是一个多子程序中控示例。主服务默认运行在 `0.0.0.0:3000`，会从注册表中加载多个子程序启动脚本，并提供统一的启动、停止、状态查看和页面跳转能力。

当前样例已内置 3 个子程序：

- `app-1`（2048 小游戏）-> 默认端口 `4000`
- `app-2` -> 默认端口 `4001`
- `app-3` -> 默认端口 `4002`

并集成了一个真实子程序：

- `satellite`（FY3F 卫星遥测分析 App）-> 默认端口 `4003`

## 目录结构

- `server.js` - 主应用入口，负责加载子程序注册表、启动和管理子程序。
- `apps.config.js` - 子程序注册表。最简单的写法只需要填写子程序启动脚本路径。
- `load-env.js` - 根目录 `.env` 读取器。
- `public/` - 主应用前端静态资源。
- `child-apps/` - 样例子程序目录。
  - `2048/server.js`
  - `app-2/server.js`
  - `app-3/server.js`

## 环境变量

根目录可使用 `.env` 文件，示例见 [`.env.example`](/Users/zhengchengxin/workplace/central-control/.env.example:1)：

```env
HOST=0.0.0.0
PORT=3000
CHILD_HOST=0.0.0.0
CHILD_BASE_PORT=4000
```

含义如下：

- `HOST` - 主程序绑定 IP
- `PORT` - 主程序端口
- `CHILD_HOST` - 所有子程序默认绑定 IP
- `CHILD_BASE_PORT` - 子程序起始端口，后续子程序按顺序递增

## 安装与运行

1. 安装依赖

```bash
npm install
```

2. 创建配置文件

```bash
cp .env.example .env
```

3. 启动主程序

```bash
npm start
```

4. 在浏览器访问

```text
http://<主机IP>:3000
```

## 多子程序接入方式

如果你要新增一个子程序，默认只需要两步。

### 1. 提供子程序启动脚本

例如新增文件：

```text
./child-apps/app-4/server.js
```

该脚本只需要能正常启动一个服务，并读取这两个环境变量：

- `CHILD_HOST`
- `CHILD_PORT`

最小示例：

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

### 2. 在注册表里登记脚本

编辑 [apps.config.js](/Users/zhengchengxin/workplace/central-control/apps.config.js:1)，直接追加脚本路径：

```js
module.exports = [
  './child-apps/app-1/server.js',
  './child-apps/app-2/server.js',
  './child-apps/app-3/server.js',
  './child-apps/app-4/server.js',
];
```

完成后，主程序就会自动把它纳入管理。

## 集成 satellite 子程序（Python 程序）

`satellite` 是一个 Python(FastAPI + uvicorn) 程序（见
[`app/README.md`](/Users/zhengchengxin/workplace/satellite/app/README.md:1)）。中控统一以
Node 脚本的形式拉起子程序，因此这里用一层 Node 包装脚本
[`child-apps/satellite/server.js`](/Users/zhengchengxin/workplace/central-control/child-apps/satellite/server.js:1)
把中控注入的 `CHILD_HOST` / `CHILD_PORT` 透传给 uvicorn，并转发日志与停止信号，让 Python
子进程随中控一并启停。

接入前需要先准备好运行环境（一次性）：

1. 安装卫星 App 的 Python 依赖（建议用独立虚拟环境）：

   ```bash
   <你的python> -m pip install -r /Users/zhengchengxin/workplace/satellite/app/backend/requirements.txt
   ```

2. 在根目录 `.env` 中指向该环境与仓库根目录（默认值见 `.env.example`）：

   ```env
   SATELLITE_ROOT=/Users/zhengchengxin/workplace/satellite
   SATELLITE_PYTHON=/path/to/your/python      # 已装好上面依赖的解释器
   # 可选 Agent LLM：LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
   ```

3.（可选，建议）构建前端，让单端口同时托管页面与接口：

   ```bash
   cd /Users/zhengchengxin/workplace/satellite/app/frontend && npm install && npm run build
   ```

   构建后 `app/backend/main.py` 会自动把前端挂到 `/`，即可在「打开页面」按钮访问完整界面；
   未构建时仅 `/api/*` 可用。

完成后在主程序首页点「启动」即可拉起；若 `SATELLITE_PYTHON` 未装依赖，子程序会以非 0 退出，
错误会显示在卡片上（如 `No module named uvicorn`）。

## 可选高级配置

如果你需要自定义子程序名称、ID、端口，也可以在 `apps.config.js` 中使用对象：

```js
module.exports = [
  './child-apps/app-1/server.js',
  {
    id: 'report-center',
    name: 'Report Center',
    script: './child-apps/report-center/server.js',
    port: 4100,
    host: '0.0.0.0',
    author: '张三', // 可选，展示在页面卡片上
  },
];
```

## API

### 主程序

- `GET /api/apps`
  - 返回所有子程序状态。

- `POST /api/apps/:appId/start`
  - 启动指定子程序。

- `POST /api/apps/:appId/stop`
  - 停止指定子程序。

### 子程序

子程序 API 由各自脚本定义。样例中的三个子程序都提供：

- `GET /api/info`

## 注意事项

- 主程序启动子程序时，会自动为其注入 `CHILD_HOST`、`CHILD_PORT`、`CHILD_APP_ID`、`CHILD_APP_NAME`。
- 前端展示的访问地址会基于当前访问主程序时使用的主机名动态生成，因此从其他机器访问主程序时，打开子程序页面也会使用同一台主机的地址。
- 如果某个子程序已在运行，再次点击启动不会重复拉起新的进程。
