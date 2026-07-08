const express = require('express');
const childProcess = require('child_process');
const path = require('path');
const httpProxy = require('http-proxy');
const { loadEnv, rootEnvPath } = require('./load-env');

loadEnv(rootEnvPath);

const app = express();
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT) || 3000;
// 子程序统一经 /apps/:appId/ 反向代理访问，默认只绑回环地址，不单独对外暴露端口。
const childHost = process.env.CHILD_HOST || '127.0.0.1';
const childBasePort = Number(process.env.CHILD_BASE_PORT) || 4000;
const childDefinitions = loadChildDefinitions();
const childRuntimes = new Map();

// 子程序反向代理：所有子程序都通过主端口下的 /apps/:appId/ 路径访问，
// 浏览器不再需要单独连接每个子端口。挂在 express.json() 之前，
// 避免子程序自己的请求体（如 multipart 上传）被主程序提前消费。
const proxy = httpProxy.createProxyServer({ ws: true });

proxy.on('error', (error, req, res) => {
  console.error(`代理转发失败：${error.message}`);
  if (res && res.writeHead && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (res && res.end) {
    res.end(`子程序不可达：${error.message}`);
  } else if (res && res.destroy) {
    res.destroy();
  }
});

// 子程序前端产物大多用绝对根路径请求资源/接口（如 /assets/x.js、fetch('/api/...')）。
// 被挂到 /apps/:id 子路径后，这些请求需要知道自己的真实前缀。
// 这里在返回的 HTML 里注入 window.__APP_BASE__，子程序前端读取它作为请求前缀
// （子程序若未适配该变量，则回退到旧的绝对路径行为，不受影响）。
proxy.on('proxyRes', (proxyRes, req, res) => {
  const contentType = proxyRes.headers['content-type'] || '';
  if (!contentType.includes('text/html')) {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
    return;
  }

  const chunks = [];
  proxyRes.on('data', (chunk) => chunks.push(chunk));
  proxyRes.on('end', () => {
    const original = Buffer.concat(chunks).toString('utf8');
    const inject = `<script>window.__APP_BASE__=${JSON.stringify(`/apps/${req.__appId}/`)};</script>`;
    const body = original.includes('<head>')
      ? original.replace('<head>', `<head>${inject}`)
      : inject + original;

    const headers = { ...proxyRes.headers };
    delete headers['content-length'];
    headers['content-length'] = Buffer.byteLength(body);
    res.writeHead(proxyRes.statusCode, headers);
    res.end(body);
  });
});

app.use('/apps/:appId', (req, res, next) => {
  // 强制尾部斜杠，保证子程序前端里的相对路径（./assets/x.js 等）
  // 以 /apps/:appId/ 为目录基准解析，而不是被误当成上一级目录。
  if (req.path === '' || req.path === '/') {
    if (!req.originalUrl.endsWith('/')) {
      return res.redirect(302, `${req.originalUrl}/`);
    }
  }

  const definition = findAppDefinition(req.params.appId);
  if (!definition) {
    return res.status(404).json({ error: 'app-not-found' });
  }

  const runtime = childRuntimes.get(definition.id);
  if (!runtime || !runtime.process || runtime.process.killed) {
    return res.status(502).json({ error: 'app-not-running' });
  }

  req.__appId = definition.id;
  proxy.web(req, res, {
    target: `http://127.0.0.1:${definition.port}`,
    selfHandleResponse: true,
  });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/apps', (req, res) => {
  res.json({
    apps: childDefinitions.map((definition) => buildAppStatus(req, definition)),
  });
});

app.post('/api/apps/:appId/start', (req, res) => {
  const definition = findAppDefinition(req.params.appId);
  if (!definition) {
    return res.status(404).json({ error: 'app-not-found' });
  }

  const runtime = childRuntimes.get(definition.id);
  if (runtime && runtime.process && !runtime.process.killed) {
    return res.json({
      status: 'running',
      app: buildAppStatus(req, definition),
    });
  }

  const spawnedProcess = childProcess.spawn(process.execPath, [definition.scriptPath], {
    cwd: path.dirname(definition.scriptPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CHILD_HOST: definition.host,
      CHILD_PORT: String(definition.port),
      CHILD_APP_ID: definition.id,
      CHILD_APP_NAME: definition.name,
    },
  });

  const nextRuntime = {
    process: spawnedProcess,
    startedAt: new Date().toISOString(),
    error: null,
  };
  childRuntimes.set(definition.id, nextRuntime);

  spawnedProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[${definition.id}] ${chunk}`);
  });
  spawnedProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[${definition.id}] ${chunk}`);
  });
  spawnedProcess.on('exit', (code, signal) => {
    const currentRuntime = childRuntimes.get(definition.id);
    if (!currentRuntime) {
      return;
    }

    console.log(`${definition.id} exited with code=${code} signal=${signal}`);
    currentRuntime.process = null;
    if (code !== 0) {
      currentRuntime.error = `Child exited with code ${code}`;
    }
  });

  return res.json({
    status: 'started',
    app: buildAppStatus(req, definition),
  });
});

app.post('/api/apps/:appId/stop', (req, res) => {
  const definition = findAppDefinition(req.params.appId);
  if (!definition) {
    return res.status(404).json({ error: 'app-not-found' });
  }

  const runtime = childRuntimes.get(definition.id);
  if (!runtime || !runtime.process || runtime.process.killed) {
    return res.status(400).json({ status: 'not-running' });
  }

  runtime.process.kill();
  res.json({ status: 'stopping' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(port, host, () => {
  console.log(`Central control server running at http://${host}:${port}`);
});

// WebSocket 升级请求不经过 Express 中间件链，需要单独在底层 HTTP server 上转发
// （满足 satellite 的 /apps/satellite/api/stream/:id 实时回放需求）。
server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/apps\/([^/]+)(\/.*)?$/);
  if (!match) {
    socket.destroy();
    return;
  }

  const [, appId, rest] = match;
  const definition = findAppDefinition(appId);
  const runtime = definition && childRuntimes.get(definition.id);
  if (!definition || !runtime || !runtime.process || runtime.process.killed) {
    socket.destroy();
    return;
  }

  req.url = rest || '/';
  proxy.ws(req, socket, head, { target: `http://127.0.0.1:${definition.port}` });
});

function loadChildDefinitions() {
  const definitions = require('./apps.config');

  return definitions.map((entry, index) => {
    if (typeof entry === 'string') {
      return normalizeDefinition({ script: entry }, index);
    }
    return normalizeDefinition(entry, index);
  });
}

function normalizeDefinition(entry, index) {
  const script = entry.script;
  if (!script) {
    throw new Error(`Invalid child app config at index ${index}: missing script`);
  }

  const scriptPath = path.resolve(__dirname, script);
  const id = entry.id || deriveAppId(scriptPath, index);
  const name = entry.name || deriveAppName(id);

  return {
    id,
    name,
    script,
    scriptPath,
    host: entry.host || childHost,
    port: Number(entry.port) || childBasePort + index,
  };
}

function deriveAppId(scriptPath, index) {
  const folderName = path.basename(path.dirname(scriptPath));
  if (folderName && folderName !== '.') {
    return folderName;
  }
  return `child-app-${index + 1}`;
}

function deriveAppName(id) {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function findAppDefinition(appId) {
  return childDefinitions.find((definition) => definition.id === appId);
}

function buildAppStatus(req, definition) {
  const runtime = childRuntimes.get(definition.id);
  const running = Boolean(runtime && runtime.process && !runtime.process.killed);

  return {
    id: definition.id,
    name: definition.name,
    script: definition.script,
    host: definition.host,
    port: definition.port,
    running,
    pid: running ? runtime.process.pid : null,
    startedAt: runtime ? runtime.startedAt : null,
    url: running ? buildPublicUrl(req, definition.id) : null,
    error: runtime ? runtime.error : null,
  };
}

function buildPublicUrl(req, appId) {
  // 统一走主端口下的 /apps/:appId/ 路径，浏览器无需再单独连接子程序端口。
  return `${req.protocol}://${req.get('host')}/apps/${appId}/`;
}
