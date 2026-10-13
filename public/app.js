const $ = id => document.getElementById(id);
const generate = $('generate');
const view = $('view');
let active = null;
let latest = null;
let submitting = false;
let stateLoading = false;
let lastImageId;
let clientError = '';
const localPage = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const storageKey = 'yuki-login-v2:' + location.pathname;
let connection;
try { connection = JSON.parse(sessionStorage.getItem(storageKey)); } catch {}
// Retire old private links and avoid retaining secrets in browser history.
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
connection ||= { bridge: localPage ? location.origin : '', key: '' };
if (connection.expiresAt && connection.expiresAt <= Date.now()) connection.key = '';
let imageLoad, blobUrl, connectionVersion = 0, stateRevision = 0;
let lastState;
let selectedCharacter;
const characterButtons = [];
let discoveryUrl, discovering = false, signingIn = false;

function normalizeBridge(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error('请填写纯服务地址。');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('远程画室需要使用 HTTPS 地址。');
  return url.origin;
}
try { if (connection.bridge) connection.bridge = normalizeBridge(connection.bridge); }
catch { connection = { bridge: localPage ? location.origin : '', key: '' }; }
function rememberConnection() { try { sessionStorage.setItem(storageKey, JSON.stringify(connection)); } catch {} }
rememberConnection();

async function initializeCharacters() {
  try {
    const response = await fetch('./characters.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('角色列表读取失败，请刷新网页。');
    const characters = await response.json();
    if (!Array.isArray(characters) || !characters.length || characters.some(item => typeof item.id !== 'string' || typeof item.name !== 'string')) throw new Error('角色列表无效，请刷新网页。');
    let previous;
    try { previous = sessionStorage.getItem(storageKey + ':character'); } catch {}
    selectedCharacter = characters.find(item => item.id === previous) || characters[0];
    for (const character of characters) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'character-button';
      button.textContent = character.name;
      button.addEventListener('click', () => {
        if (button.disabled) return;
        selectedCharacter = character;
        try { sessionStorage.setItem(storageKey + ':character', character.id); } catch {}
        updateCharacters();
      });
      characterButtons.push({ button, character });
      $('character-options').append(button);
    }
    updateCharacters();
  } catch (error) { clientError = error.message; $('character-hint').textContent = error.message; }
}
function updateCharacters(waiting = false) {
  for (const { button, character } of characterButtons) {
    const selected = character.id === selectedCharacter?.id;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('selected', selected);
    button.disabled = waiting;
  }
  if (selectedCharacter) $('character-hint').textContent = `✦ 已选择 ${selectedCharacter.name}`;
}

function openLogin() {
  $('studio-password').value = '';
  $('connect-error').hidden = true;
  if (!$('connect-dialog').open) $('connect-dialog').showModal();
}
async function discover() {
  if (localPage) { connection.bridge = location.origin; return; }
  if (discovering) return;
  discovering = true;
  try {
    if (!discoveryUrl) {
      const response = await fetch('./site-config.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('网页配置读取失败，请刷新。');
      discoveryUrl = (await response.json()).discoveryUrl;
    }
    const url = new URL(discoveryUrl);
    url.searchParams.set('t', String(Date.now()));
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000), referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('请先在电脑上双击 中文启动.cmd。');
    const record = await response.json();
    if (record.version !== 1 || !record.online || Date.parse(record.expiresAt) <= Date.now()) throw new Error('画室暂时离线，请在电脑上启动远程画室。');
    const bridge = normalizeBridge(record.bridgeUrl);
    if (!/^[a-z0-9-]+\.trycloudflare\.com$/i.test(new URL(bridge).hostname)) throw new Error('画室地址无效，请检查电脑端启动窗口。');
    if (connection.bridge !== bridge) {
      connection = { bridge, key: '' }; connectionVersion++; resetImage();
      rememberConnection();
    }
    $('discovery-status').textContent = '已找到画室，输入密码即可连接。';
  } catch (error) {
    $('discovery-status').textContent = error.message || '暂时找不到画室，请稍后重试。';
    throw error;
  } finally { discovering = false; }
}

function apiUrl(route) { return new URL(route, connection.bridge).href; }

async function api(route, options = {}) {
  const response = await fetch(apiUrl(route), { ...options, headers: { 'X-Yuki-Request': '1', Authorization: `Bearer ${connection.key}`, ...options.headers }, signal: AbortSignal.timeout(25000), cache: 'no-store', referrerPolicy: 'no-referrer' });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || '画室暂时没有回应，请稍后再试。'); error.status = response.status; throw error; }
  return data;
}

function cancelImageLoad() {
  imageLoad?.controller.abort();
  imageLoad = null;
}
function resetImage() {
  cancelImageLoad();
  lastImageId = null;
  $('result').hidden = true;
  view.disabled = true;
  $('viewer').close();
}
async function loadImage(image) {
  if (imageLoad?.id === image.id && imageLoad.version === connectionVersion) return;
  cancelImageLoad();
  const version = connectionVersion;
  const request = { id: image.id, version, controller: new AbortController() };
  imageLoad = request;
  let next;
  const isCurrent = () => imageLoad === request && version === connectionVersion && latest?.id === image.id && !active && !submitting && !lastState?.submitting;
  try {
    const response = await fetch(apiUrl(image.imageUrl), { headers: { Authorization: `Bearer ${connection.key}` }, signal: AbortSignal.any([request.controller.signal, AbortSignal.timeout(60000)]), referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('图片读取失败，请检查连接后重试。');
    const blob = await response.blob();
    if (!isCurrent()) return;
    next = URL.createObjectURL(blob);
    // Decode offscreen before swapping: polling must not expose the old image.
    const decoded = new Image();
    decoded.src = next;
    await decoded.decode();
    if (!isCurrent()) return;
    const element = $('result');
    element.src = next;
    $('full-image').src = next;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = next;
    next = null;
    lastImageId = image.id;
    clientError = '';
    render(lastState);
  } catch (error) {
    if (isCurrent()) {
      clientError = error.message || '图片加载失败，请稍后重试。';
      $('error').hidden = false; $('error').textContent = clientError;
      $('status-text').textContent = '图片还未加载成功，正在等待重试。';
    }
  } finally {
    if (next) URL.revokeObjectURL(next);
    if (imageLoad === request) imageLoad = null;
  }
}

function render(state) {
  lastState = state;
  active = state.active;
  latest = state.latest;
  const busy = Boolean(active || submitting || state.submitting);
  const loading = !busy && Boolean(latest && latest.id !== lastImageId);
  const waiting = busy || loading;
  const imageReady = !waiting && Boolean(latest && latest.id === lastImageId);
  if (busy || !latest) cancelImageLoad();
  $('connection').classList.toggle('online', state.connected);
  $('connection-text').textContent = state.connected ? '画室已连接' : '等待 ComfyUI';
  generate.disabled = waiting || !state.connected || !selectedCharacter;
  updateCharacters(waiting);
  $('generate-label').textContent = loading ? '正在加载新图片' : busy ? '正在生成，请稍候' : '生成一张图片';
  view.disabled = !imageReady;
  $('result').hidden = !imageReady;
  $('placeholder').hidden = imageReady;
  $('art-caption').textContent = loading ? '新的画面，正在向你走来' : busy ? '等待这一场新的相遇' : imageReady ? '这一次，与你相遇的画面' : '等待一场灵感的初雪';
  $('progress-track').hidden = !waiting;
  $('progress-track').classList.toggle('indeterminate', loading || (busy && !active?.progress));
  $('progress-bar').style.width = `${active?.progress || 0}%`;
  $('drawing-overlay').hidden = !waiting;
  $('drawing-label').textContent = loading ? '正在加载新图片，请稍候' : '正在让想象变成画面';
  $('elapsed').hidden = loading;
  $('status-symbol').textContent = waiting ? '❄' : '✦';
  $('status-text').textContent = active ? `${active.stage}${active.progress ? ` · ${active.progress}%` : ''}` : submitting || state.submitting ? '正在抽取一个新故事' : loading ? '绘制完成，正在加载新图片…' : !state.connected ? '打开 ComfyUI 后，就可以开始画画了' : imageReady ? `画好了，用了 ${latest.seconds} 秒。点击查看完整图片。` : '准备好了，下一张会是什么呢？';
  const error = state.error || clientError;
  $('error').hidden = !error;
  $('error').textContent = error || '';
  if (loading) {
    loadImage(latest);
  }
}

async function refresh() {
  if (stateLoading) return;
  if (!connection.bridge || !connection.key) {
    generate.disabled = true;
    $('connection-text').textContent = '输入密码';
    $('status-text').textContent = '点击右上角，输入密码进入画室。';
    return;
  }
  stateLoading = true;
  const version = connectionVersion, revision = stateRevision;
  try {
    const state = await api('/api/state');
    if (version === connectionVersion && revision === stateRevision) render(state);
  }
  catch (error) {
    if (version !== connectionVersion || revision !== stateRevision) return;
    $('connection').classList.remove('online');
    $('connection-text').textContent = error.status === 401 ? '重新连接画室' : '画室暂时离线';
    generate.disabled = true;
    $('status-text').textContent = error.status === 401 ? '登录已过期，请重新输入画室密码。' : '请保持电脑端画室运行，网页会自动寻找新的连接。';
    if (error.status === 401) { connection.key = ''; rememberConnection(); openLogin(); }
  } finally { stateLoading = false; }
}

generate.addEventListener('click', async () => {
  if (generate.disabled || submitting || active) return;
  stateRevision++;
  submitting = true;
  clientError = '';
  render({ active, latest, connected: true });
  try {
    const job = await api('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: selectedCharacter.id }) });
    stateRevision++;
    render({ active: job, latest, connected: true });
  }
  catch (error) { clientError = error.message; }
  finally { submitting = false; await refresh(); }
});
view.addEventListener('click', () => { if (!view.disabled && latest?.id === lastImageId) $('viewer').showModal(); });
$('close-viewer').addEventListener('click', () => $('viewer').close());
$('viewer').addEventListener('click', event => { if (event.target === $('viewer')) $('viewer').close(); });
setInterval(() => {
  const seconds = active ? Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000)) : 0;
  $('elapsed').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}, 1000);
setInterval(refresh, 1300);
async function initialize() {
  await initializeCharacters();
  try { await discover(); } catch {}
  if (localPage && !connection.key) {
    try {
      const response = await fetch('/api/session', { headers: { 'X-Yuki-Request': '1' }, cache: 'no-store' });
      const session = await response.json();
      if (response.ok) { connection.key = session.accessKey; rememberConnection(); }
    } catch {}
  }
  await refresh();
  if (!connection.key) openLogin();
}
$('connection').addEventListener('click', () => {
  openLogin();
  discover().catch(() => {});
});
$('close-connect').addEventListener('click', () => $('connect-dialog').close());
$('connect-dialog').addEventListener('click', event => { if (event.target === $('connect-dialog')) $('connect-dialog').close(); });
$('connect-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (signingIn) return;
  signingIn = true;
  $('login-button').disabled = true;
  $('connect-error').hidden = true;
  try {
    await discover();
    if (!connection.bridge) throw new Error('请先在电脑上启动远程画室。');
    const password = $('studio-password').value;
    const session = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    connection.key = session.accessKey;
    connection.expiresAt = session.expiresAt;
    rememberConnection();
    const state = await api('/api/state');
    connectionVersion++;
    rememberConnection(); clientError = ''; resetImage();
    $('connect-dialog').close(); render(state);
  } catch (error) {
    $('connect-error').textContent = error.message || '连接失败，请确认电脑端画室正在运行。';
    $('connect-error').hidden = false;
  } finally {
    $('studio-password').value = '';
    signingIn = false; $('login-button').disabled = false;
  }
});
setInterval(() => { discover().then(refresh).catch(() => {}); }, 60000);
initialize();

// Soft snowfall: decorative only, capped for mobile, and respects reduced motion.
const canvas = $('snow');
const context = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let flakes = [], width = 0, height = 0, lastTime = 0, animationId;
function resizeSnow() {
  width = innerWidth; height = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, width < 760 ? 1.25 : 1.5);
  canvas.width = width * dpr; canvas.height = height * dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  flakes = Array.from({ length: width < 760 ? 34 : 60 }, () => ({ x: Math.random() * width, y: Math.random() * height, layer: Math.floor(Math.random() * 3), speed: 12 + Math.random() * 26, sway: Math.random() * 6.28 }));
}
function snow(time) {
  if (reducedMotion.matches) return;
  const delta = Math.min((time - lastTime) / 1000 || .016, .05);
  lastTime = time;
  context.clearRect(0, 0, width, height);
  for (const flake of flakes) {
    flake.y += flake.speed * delta;
    flake.x += Math.sin(time / 2600 + flake.sway) * 8 * delta;
    if (flake.y > height + 5) { flake.y = -5; flake.x = Math.random() * width; }
  }
  // Three depth layers share three canvas fills, instead of a fill per flake.
  for (let layer = 0; layer < 3; layer++) {
    context.beginPath();
    const radius = .8 + layer * .7;
    for (const flake of flakes) {
      if (flake.layer !== layer) continue;
      context.moveTo(flake.x + radius, flake.y);
      context.arc(flake.x, flake.y, radius, 0, Math.PI * 2);
    }
    context.fillStyle = `rgba(232,226,255,${.25 + layer * .22})`;
    context.fill();
  }
  animationId = requestAnimationFrame(snow);
}
function startSnow() {
  cancelAnimationFrame(animationId);
  document.body?.classList.toggle('motion-paused', document.hidden);
  if (!reducedMotion.matches && !document.hidden) { lastTime = 0; animationId = requestAnimationFrame(snow); }
}
addEventListener('resize', resizeSnow);
reducedMotion.addEventListener('change', startSnow);
document.addEventListener('visibilitychange', startSnow);
resizeSnow(); startSnow();
