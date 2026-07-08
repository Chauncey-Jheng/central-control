// 通用的“通过 SSH 在远程服务器上拉起子程序”包装器。
//
// 4090D 和 172.21.13.x 网段之间没有直接路由，只能经 172.19.27.89 跳板用 SSH 连通，
// 所以中控没法直接拿远程 IP:端口去反向代理，这里额外用同一个 SSH 会话做本地端口转发
// （-L localPort:127.0.0.1:remotePort），中控只需要连 127.0.0.1:localPort。
//
// 关闭子程序时不能只指望“断开本地 ssh 就会连带杀死远程前台进程”——实测过，
// 断开 ProxyJump 的 ssh 连接后，远程进程可能继续存活，变成孤儿占着端口，导致
// 下次启动失败。所以 remoteCommand 必须在最前面打印 `REMOTE_PID:<pid>`
// （配合最终一步用 exec 替换 shell，保证这个 PID 和真正跑起来的程序 PID 一致），
// 关闭时先专门发一次 SSH 去精确 kill 这个远程 PID，再关本地隧道。
const childProcess = require('child_process');
const readline = require('readline');

function spawnRemoteChild({ jumpUser, jumpHost, user, host, remoteCommand, appName, localPort, remotePort }) {
  const jumpTarget = `${jumpUser}@${jumpHost}`;
  const target = `${user}@${host}`;
  const sshOpts = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
  ];
  const fullCommand = `echo REMOTE_PID:$$ && ${remoteCommand}`;
  const args = [...sshOpts, '-L', `${localPort}:127.0.0.1:${remotePort}`, '-J', jumpTarget, target, fullCommand];

  console.log(
    `${appName} -> ssh -L ${localPort}:127.0.0.1:${remotePort} -J ${jumpTarget} ${target} "${remoteCommand}"`,
  );

  const child = childProcess.spawn('ssh', args, { stdio: ['ignore', 'pipe', 'inherit'] });

  let remotePid = null;
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const match = line.match(/^REMOTE_PID:(\d+)$/);
    if (match) {
      remotePid = match[1];
      console.log(`${appName} 远程 PID：${remotePid}（${host}）`);
      return;
    }
    process.stdout.write(`${line}\n`);
  });

  child.on('error', (error) => {
    console.error(
      `${appName} SSH 启动失败：${error.message}\n` +
        `请确认 4090D 已对 ${jumpHost} 和 ${host} 配置好免密 SSH（公钥已加入对方 authorized_keys）。`,
    );
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    console.log(`${appName} ssh 会话退出 code=${code} signal=${signal}`);
    process.exit(code === null ? 1 : code);
  });

  let stopping = false;
  function forwardSignal(signal) {
    if (stopping) {
      return;
    }
    stopping = true;

    const killRemote = remotePid
      ? childProcess.spawn(
          'ssh',
          [...sshOpts, '-J', jumpTarget, target, `kill ${remotePid} 2>/dev/null`],
          { stdio: 'ignore' },
        )
      : null;

    const closeTunnel = () => {
      if (child && !child.killed) {
        child.kill(signal);
      }
    };

    if (killRemote) {
      killRemote.on('exit', closeTunnel);
      killRemote.on('error', closeTunnel);
      // 万一那次 SSH 卡住（例如跳板机也断了），别无限期拖着不关本地隧道。
      setTimeout(closeTunnel, 5000);
    } else {
      closeTunnel();
    }
  }

  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  process.on('SIGINT', () => forwardSignal('SIGINT'));
}

module.exports = { spawnRemoteChild };
