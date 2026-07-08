// 故障检测智能体（guoyuanzhen，32 号服务器 172.21.13.32）。
// FastAPI/uvicorn 程序：webui/run_webui.sh 内部会自行 conda activate fault，
// 默认绑定 0.0.0.0:8600（脚本第一个参数可覆盖端口，这里用默认值）。
const { spawnRemoteChild } = require('../lib/remote-ssh-child');

const appName = process.env.CHILD_APP_NAME || 'Fault Diagnosis';

spawnRemoteChild({
  jumpUser: 'bjutcv',
  jumpHost: '172.19.27.89',
  user: 'bjutcv',
  host: '172.21.13.32',
  remoteCommand:
    'source ~/anaconda3/etc/profile.d/conda.sh && ' +
    'cd /home/bjutcv/data/guoyuanzhen/fault_diagnosis && exec bash webui/run_webui.sh',
  appName,
  localPort: 8600,
  remotePort: 8600,
});
