const appList = document.getElementById('appList');

async function fetchApps() {
  const response = await fetch('/api/apps');
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }
  return response.json();
}

async function refreshApps() {
  try {
    const data = await fetchApps();
    renderApps(data.apps);
  } catch (error) {
    appList.innerHTML = `<div class="empty">状态加载失败：${error.message}</div>`;
  }
}

function renderApps(apps) {
  appList.innerHTML = '';

  if (!apps.length) {
    appList.innerHTML = '<div class="empty">当前没有可管理的子程序。</div>';
    return;
  }

  for (const childApp of apps) {
    const card = document.createElement('article');
    card.className = 'app-card';

    const statusLabel = childApp.running ? '运行中' : '未启动';
    const urlText = childApp.url || '-';
    const errorText = childApp.error || '-';

    card.innerHTML = `
      <div class="app-header">
        <div>
          <h2>${escapeHtml(childApp.name)}</h2>
          <div class="app-meta">${escapeHtml(childApp.id)} | ${escapeHtml(childApp.script)}</div>
        <div class="app-meta">作者：${escapeHtml(childApp.author || '-')}</div>
        </div>
        <span class="badge ${childApp.running ? 'running' : 'stopped'}">${statusLabel}</span>
      </div>
      <div class="app-info">
        <div>内网访问地址：${escapeHtml(childApp.host)}:${childApp.port}</div>
        <div>访问地址：${escapeHtml(urlText)}</div>
        <div>PID：${childApp.pid || '-'}</div>
        <div>启动时间：${escapeHtml(childApp.startedAt || '-')}</div>
        <div>错误：${escapeHtml(errorText)}</div>
      </div>
      <div class="button-row">
        <button data-action="start" data-app-id="${escapeHtml(childApp.id)}" ${childApp.running ? 'disabled' : ''}>启动</button>
        <button data-action="open" data-url="${escapeHtml(urlText)}" ${childApp.running ? '' : 'disabled'}>打开页面</button>
        <button data-action="stop" data-app-id="${escapeHtml(childApp.id)}" ${childApp.running ? '' : 'disabled'}>关闭</button>
      </div>
    `;

    appList.appendChild(card);
  }
}

appList.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  if (action === 'open') {
    if (button.dataset.url) {
      window.open(button.dataset.url, '_blank');
    }
    return;
  }

  const appId = button.dataset.appId;
  if (!appId) {
    return;
  }

  disableCardButtons(button.closest('.app-card'), true);

  try {
    const response = await fetch(`/api/apps/${appId}/${action}`, { method: 'POST' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || payload.status || `请求失败: ${response.status}`);
    }
    await refreshApps();
  } catch (error) {
    await refreshApps();
    alert(`${action === 'start' ? '启动' : '关闭'}失败：${error.message}`);
  }
});

function disableCardButtons(card, disabled) {
  if (!card) {
    return;
  }

  const buttons = card.querySelectorAll('button');
  buttons.forEach((button) => {
    button.disabled = disabled;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

refreshApps();
setInterval(refreshApps, 2000);
