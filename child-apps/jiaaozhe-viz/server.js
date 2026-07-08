// 贾奥哲做的可视化系统（171 号服务器 172.21.13.171）。
// 需要先 conda activate jaz_streamlit，再以 streamlit 启动 captioning.py。
// 显式传 --server.address/--server.port，不依赖 streamlit 自己的默认绑定行为。
const { spawnRemoteChild } = require('../lib/remote-ssh-child');

const appName = process.env.CHILD_APP_NAME || 'Visualization';

spawnRemoteChild({
  jumpUser: 'bjutcv',
  jumpHost: '172.19.27.89',
  user: 'bjutcv',
  host: '172.21.13.171',
  remoteCommand:
    'source ~/anaconda3/etc/profile.d/conda.sh && conda activate jaz_streamlit && ' +
    'cd /home/bjutcv/data/jiaaozhe/visualization && ' +
    'exec streamlit run captioning.py --server.address 0.0.0.0 --server.port 8501 --server.headless true',
  appName,
  localPort: 8501,
  remotePort: 8501,
});
