module.exports = [
  {
    id: 'app-1',
    name: '2048',
    script: './child-apps/2048/server.js',
    author: '郑诚信',
  },
  {
    id: 'app-2',
    name: 'App 2',
    script: './child-apps/app-2/server.js',
    author: '郑诚信',
  },
  {
    id: 'app-3',
    name: 'App 3',
    script: './child-apps/app-3/server.js',
    author: '郑诚信',
  },
  {
    id: 'satellite',
    name: 'FY3F 卫星遥测分析',
    // Python(FastAPI/uvicorn) 程序，由 Node 包装脚本统一拉起，见同目录 README 说明。
    script: './child-apps/satellite/server.js',
    author: '郑诚信',
  },
  {
    id: 'fault-diagnosis',
    name: '故障检测智能体',
    // 跑在 32 号服务器（172.21.13.32）。4090D 和 172.21.13.x 网段没有直接路由，
    // Node 包装脚本通过 SSH 跳板远程拉起，并用同一个 SSH 会话做本地端口转发，
    // 所以这里 proxyTarget 仍是默认的 127.0.0.1。见 child-apps/lib/remote-ssh-child.js。
    // lanHost 显式指定成对方机器的真实 IP，纯粹用于页面展示（中控自己探测不出来）。
    script: './child-apps/fault-diagnosis/server.js',
    port: 8600,
    lanHost: '172.21.13.32',
    author: '郭元祯',
  },
  {
    id: 'jaz-caption',
    name: 'Caption 可解释性展示系统',
    // 跑在 32 号服务器（172.21.13.32），同上通过 SSH 远程拉起 + 本地端口转发。
    script: './child-apps/jaz-caption/server.js',
    port: 7860,
    lanHost: '172.21.13.32',
    author: '郭元祯',
  },
  {
    id: 'pcrl-mrg',
    name: '脑CT报告生成推理系统',
    // PCRL-MRG（EMNLP 2024）：ViT-MLP-LLaMA3-8B(LoRA) 脑CT报告生成模型的单独部署推理
    // 服务，Python(FastAPI/uvicorn) 程序，由 Node 包装脚本统一拉起，见同目录 server.js
    // 及 PCRL-MRG 仓库自己的 CLAUDE.md "Standalone Inference Deployment" 一节。
    // 和 central-control 跑在同一台机器（4090D）上，proxyTarget 用默认的 127.0.0.1。
    script: './child-apps/pcrl-mrg/server.js',
    port: 8700,
    author: '郑诚信',
  },
];
