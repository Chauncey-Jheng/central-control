const express = require('express');
const path = require('path');
const { loadEnv, rootEnvPath } = require('../../load-env');

loadEnv(rootEnvPath);

const app = express();
const host = process.env.CHILD_HOST || '0.0.0.0';
const port = Number(process.env.CHILD_PORT) || 4002;
const appName = process.env.CHILD_APP_NAME || 'App 3';

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/info', (_req, res) => {
  res.json({
    appName,
    message: '示例子程序 3 已启动',
    time: new Date().toISOString(),
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, host, () => {
  console.log(`${appName} running at http://${host}:${port}`);
});
