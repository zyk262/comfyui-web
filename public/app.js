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
const storageKey = 'yuki-connection:' + location.pathname;
let connection;
try { connection = JSON.parse(sessionStorage.getItem(storageKey)); } catch {}
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('bridge') && fragment.has('key')) {
  connection = { bridge: fragment.get('bridge'), key: fragment.get('key') };
  history.replaceState(null, '', location.pathname + location.search);
}
connection ||= { bridge: localPage ? location.origin : '', key: '' };
let imageLoadingId, blobUrl, connectionVersion = 0;

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

function apiUrl(route) { return new URL(route, connection.bridge).href; }

async function api(route, options = {}) {
  const response = await fetch(apiUrl(route), { ...options, headers: { 'X-Yuki-Request': '1', Authorization: `Bearer ${connection.key}`, ...options.headers }, signal: AbortSignal.timeout(25000), cache: 'no-store', referrerPolicy: 'no-referrer' });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || '画室暂时没有回应，请稍后再试。'); error.status = response.status; throw error; }
  return data;
}

async function loadImage(image) {
  if (imageLoadingId === image.id) return;
  imageLoadingId = image.id;
  const version = connectionVersion;
  try {
    const response = await fetch(apiUrl(image.imageUrl), { headers: { Authorization: `Bearer ${connection.key}` }, signal: AbortSignal.timeout(60000), referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('图片读取失败，请检查连接后重试。');
    const blob = await response.blob();
    if (version !== connectionVersion) return;
    const next = URL.createObjectURL(blob);
    const element = $('result');
    element.onload = () => { $('placeholder').hidden = true; element.hidden = false; $('art-caption').textContent = '这一次，与你相遇的画面'; lastImageId = image.id; };
    element.src = next;
    $('full-image').src = next;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = next;
  } catch (error) { clientError = error.message; $('error').hidden = false; $('error').textContent = clientError; }
  finally { if (version === connectionVersion) imageLoadingId = null; }
}

function render(state) {
  active = state.active;
  latest = state.latest;
  const busy = Boolean(active || submitting || state.submitting);
  $('connection').classList.toggle('online', state.connected);
  $('connection-text').textContent = state.connected ? '画室已连接' : '等待 ComfyUI';
  generate.disabled = busy || !state.connected;
  $('generate-label').textContent = busy ? '正在生成，请稍候' : '生成一张图片';
  view.disabled = !latest;
  $('progress-track').hidden = !busy;
  $('progress-track').classList.toggle('indeterminate', busy && !active?.progress);
  $('progress-bar').style.width = `${active?.progress || 0}%`;
  $('drawing-overlay').hidden = !busy;
  $('status-symbol').textContent = busy ? '❄' : '✦';
  $('status-text').textContent = active ? `${active.stage}${active.progress ? ` · ${active.progress}%` : ''}` : submitting ? '正在抽取一个新故事' : !state.connected ? '打开 ComfyUI 后，就可以开始画画了' : latest ? `画好了，用了 ${latest.seconds} 秒。点击查看完整图片。` : '准备好了，下一张会是什么呢？';
  const error = state.error || clientError;
  $('error').hidden = !error;
  $('error').textContent = error || '';
  if (latest && latest.id !== lastImageId) {
    loadImage(latest);
  }
}

async function refresh() {
  if (stateLoading) return;
  if (!connection.bridge || !connection.key) {
    generate.disabled = true;
    $('connection-text').textContent = '连接你的画室';
    $('status-text').textContent = '点击右上角连接，或使用电脑生成的私人链接。';
    return;
  }
  stateLoading = true;
  try { render(await api('/api/state')); }
  catch (error) {
    $('connection').classList.remove('online');
    $('connection-text').textContent = error.status === 401 ? '重新连接画室' : '画室暂时离线';
    generate.disabled = true;
    $('status-text').textContent = error.status === 401 ? '访问口令不正确，点击右上角更新连接。' : '请保持电脑端画室运行；重启后使用新的私人链接。';
  } finally { stateLoading = false; }
}

generate.addEventListener('click', async () => {
  if (submitting || active) return;
  submitting = true;
  clientError = '';
  render({ active, latest, connected: true });
  try { await api('/api/generate', { method: 'POST' }); }
  catch (error) { clientError = error.message; }
  finally { submitting = false; await refresh(); }
});
view.addEventListener('click', () => { if (latest) $('viewer').showModal(); });
$('close-viewer').addEventListener('click', () => $('viewer').close());
$('viewer').addEventListener('click', event => { if (event.target === $('viewer')) $('viewer').close(); });
setInterval(() => {
  const seconds = active ? Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000)) : 0;
  $('elapsed').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}, 1000);
setInterval(refresh, 1300);
async function initialize() {
  if (localPage && !connection.key) {
    try {
      const response = await fetch('/api/session', { headers: { 'X-Yuki-Request': '1' }, cache: 'no-store' });
      const session = await response.json();
      if (response.ok) { connection.key = session.accessKey; rememberConnection(); }
    } catch {}
  }
  await refresh();
}
$('connection').addEventListener('click', () => {
  $('bridge-url').value = connection.bridge;
  $('access-key').value = connection.key;
  $('connect-error').hidden = true;
  $('connect-dialog').showModal();
});
$('close-connect').addEventListener('click', () => $('connect-dialog').close());
$('connect-dialog').addEventListener('click', event => { if (event.target === $('connect-dialog')) $('connect-dialog').close(); });
$('connect-form').addEventListener('submit', async event => {
  event.preventDefault();
  const previous = connection;
  try {
    connection = { bridge: normalizeBridge($('bridge-url').value.trim()), key: $('access-key').value.trim() };
    if (!connection.key) throw new Error('请填写访问口令。');
    const state = await api('/api/state');
    connectionVersion++;
    rememberConnection(); clientError = ''; lastImageId = null;
    $('connect-dialog').close(); render(state);
  } catch (error) {
    connection = previous;
    $('connect-error').textContent = error.status ? error.message : '连接失败，请检查服务地址和电脑端画室是否在线。';
    $('connect-error').hidden = false;
  }
});
initialize();

// Soft snowfall: decorative only, capped for mobile, and respects reduced motion.
const canvas = $('snow');
const context = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let flakes = [], width = 0, height = 0, lastTime = 0, animationId;
function resizeSnow() {
  width = innerWidth; height = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = width * dpr; canvas.height = height * dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  flakes = Array.from({ length: width < 760 ? 36 : 68 }, () => ({ x: Math.random() * width, y: Math.random() * height, radius: .9 + Math.random() * 2.2, speed: 10 + Math.random() * 24, sway: Math.random() * 6.28, opacity: .3 + Math.random() * .5 }));
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
    context.beginPath(); context.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
    context.fillStyle = `rgba(255,255,255,${flake.opacity})`; context.fill();
  }
  animationId = requestAnimationFrame(snow);
}
function startSnow() {
  cancelAnimationFrame(animationId);
  if (!reducedMotion.matches && !document.hidden) { lastTime = 0; animationId = requestAnimationFrame(snow); }
}
addEventListener('resize', resizeSnow);
reducedMotion.addEventListener('change', startSnow);
document.addEventListener('visibilitychange', startSnow);
resizeSnow(); startSnow();
