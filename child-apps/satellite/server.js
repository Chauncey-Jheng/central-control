// FY3F 卫星遥测分析 App 是 Python(FastAPI + uvicorn) 程序，而中控统一以 Node 脚本
// 的形式拉起/停止子程序。这里用一层 Node 包装：把中控注入的 CHILD_HOST / CHILD_PORT
// 透传给 uvicorn，并转发日志与停止信号，让 Python 子进程随中控统一管理。
//
// 详见被集成程序的说明：/Users/zhengchengxin/workplace/satellite/app/README.md
const childProcess = require('child_process');
const { loadEnv, rootEnvPath } = require('../../load-env');

loadEnv(rootEnvPath);

const host = process.env.CHILD_HOST || '0.0.0.0';
const port = Number(process.env.CHILD_PORT) || 8000;
const appName = process.env.CHILD_APP_NAME || 'Satellite';

// 卫星仓库根目录（uvicorn 的工作目录，模块路径 app.backend.main:app 相对于此）。
const satelliteRoot =
  process.env.SATELLITE_ROOT || '/Users/zhengchengxin/workplace/satellite';
// Python 解释器。README 里的 conda 绝对路径仅适用于原开发机，这里允许用环境变量覆盖，
// 默认回退到 python3；务必指向已安装 app/backend/requirements.txt 依赖的解释器。
const python = process.env.SATELLITE_PYTHON || 'python3';

const args = [
  '-m',
  'uvicorn',
  'app.backend.main:app',
  '--host',
  host,
  '--port',
  String(port),
];

console.log(`${appName} -> ${python} -m uvicorn app.backend.main:app @ ${satelliteRoot}`);

const child = childProcess.spawn(python, args, {
  cwd: satelliteRoot,
  // 继承本进程的 stdio：本进程的 stdout/stderr 已被中控接管并加前缀输出。
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error(
    `${appName} 启动失败：${error.message}\n` +
      `请确认 SATELLITE_PYTHON(=${python}) 可用，且已安装 ` +
      `${satelliteRoot}/app/backend/requirements.txt 中的依赖。`,
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
