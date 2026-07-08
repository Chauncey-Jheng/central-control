// Caption 可解释性展示系统（guoyuanzhen，32 号服务器 172.21.13.32）。
// 需要先 conda activate jaz，再以 0.0.0.0:7860 启动。
const { spawnRemoteChild } = require('../lib/remote-ssh-child');

const appName = process.env.CHILD_APP_NAME || 'Caption Explain';

spawnRemoteChild({
  jumpUser: 'bjutcv',
  jumpHost: '172.19.27.89',
  user: 'bjutcv',
  host: '172.21.13.32',
  remoteCommand:
    'source ~/anaconda3/etc/profile.d/conda.sh && conda activate jaz && ' +
    'cd /home/bjutcv/data/guoyuanzhen/jaz_scale && ' +
    'exec python caption_explain_web.py --host 0.0.0.0 --port 7860',
  appName,
  localPort: 7860,
  remotePort: 7860,
});
