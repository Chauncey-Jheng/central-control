// 脑CT报告生成推理系统（PCRL-MRG）是 Python(FastAPI + uvicorn) 程序，中控统一以 Node
// 脚本的形式拉起/停止子程序。这里用一层 Node 包装：把中控注入的 CHILD_HOST / CHILD_PORT
// 透传给 uvicorn，并转发日志与停止信号，让 Python 子进程随中控统一管理。
//
// 详见被集成程序的说明：<PCRL_MRG_ROOT>/CLAUDE.md 的 "Standalone Inference Deployment" 一节。
const childProcess = require('child_process');
const { loadEnv, rootEnvPath } = require('../../load-env');

loadEnv(rootEnvPath);

const host = process.env.CHILD_HOST || '0.0.0.0';
const port = Number(process.env.CHILD_PORT) || 8700;
const appName = process.env.CHILD_APP_NAME || 'PCRL-MRG';

// PCRL-MRG 仓库根目录；uvicorn 的工作目录是其下的 inference/ 子目录（server.py 所在处），
// 用来把 engine.py 的相对导入解析成同目录下的模块。
const pcrlRoot = process.env.PCRL_MRG_ROOT || '/home/bjutcv/data/zcx/PCRL-MRG';
// Python 解释器：必须是已安装 requirements.txt 依赖（含 torch/transformers/peft/
// bitsandbytes/fastapi/uvicorn 等）且能访问 GPU 的解释器，原始训练/推理都用这个环境。
const python = process.env.PCRL_MRG_PYTHON || 'python3';

const args = ['-m', 'uvicorn', 'server:app', '--host', host, '--port', String(port)];

console.log(`${appName} -> ${python} -m uvicorn server:app @ ${pcrlRoot}/inference`);

const child = childProcess.spawn(python, args, {
  cwd: `${pcrlRoot}/inference`,
  // 继承本进程的 stdio：本进程的 stdout/stderr 已被中控接管并加前缀输出。
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error(
    `${appName} 启动失败：${error.message}\n` +
      `请确认 PCRL_MRG_PYTHON(=${python}) 可用，且已安装 ` +
      `${pcrlRoot}/requirements.txt 中的依赖，同时 PCRL_MRG_ROOT(=${pcrlRoot}) 指向真实仓库路径。`,
  );
  process.exit(1);
});

child.on('exit', (code, signal) => {
  console.log(`${appName} uvicorn 退出 code=${code} signal=${signal}`);
  process.exit(code === null ? 1 : code);
});

// 中控停止子程序时会向本包装进程发送 SIGTERM，需转发给 uvicorn，避免孤儿进程。
function forwardSignal(signal) {
  if (child && !child.killed) {
    child.kill(signal);
  }
}

process.on('SIGTERM', () => forwardSignal('SIGTERM'));
process.on('SIGINT', () => forwardSignal('SIGINT'));
