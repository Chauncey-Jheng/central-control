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
];
