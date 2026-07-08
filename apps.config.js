module.exports = [
  './child-apps/app-1/server.js',
  './child-apps/app-2/server.js',
  './child-apps/app-3/server.js',
  {
    id: 'satellite',
    name: 'FY3F 卫星遥测分析',
    // Python(FastAPI/uvicorn) 程序，由 Node 包装脚本统一拉起，见同目录 README 说明。
    script: './child-apps/satellite/server.js',
  },
  {
    id: 'fault-diagnosis',
    name: '故障检测智能体',
    // 跑在 32 号服务器（172.21.13.32）。4090D 和 172.21.13.x 网段没有直接路由，
    // Node 包装脚本通过 SSH 跳板远程拉起，并用同一个 SSH 会话做本地端口转发，
    // 所以这里 proxyTarget 仍是默认的 127.0.0.1。见 child-apps/lib/remote-ssh-child.js。
    script: './child-apps/fault-diagnosis/server.js',
    port: 8600,
  },
  {
    id: 'jaz-caption',
    name: 'Caption 可解释性展示系统',
    // 跑在 32 号服务器（172.21.13.32），同上通过 SSH 远程拉起 + 本地端口转发。
    script: './child-apps/jaz-caption/server.js',
    port: 7860,
  },
  {
    id: 'jiaaozhe-viz',
    name: '可视化系统（贾奥哲）',
    // 跑在 171 号服务器（172.21.13.171），同上通过 SSH 远程拉起 + 本地端口转发。
    script: './child-apps/jiaaozhe-viz/server.js',
    port: 8501,
  },
];
