import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { prepareWorkflow, characterRandomMetadata, historyError, historyImages } from './workflow.mjs';
import { parseCharacters } from './characters.mjs';
import { checkRequest } from './security.mjs';
import { verifyPassword, LoginGuard, Sessions } from './auth.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
const port = Number(process.env.PORT || config.port || 3210);
const comfyUrl = new URL(process.env.COMFY_URL || config.comfyUrl);
const localDir = path.resolve(root, process.env.YUKI_LOCAL_DIR || '.local');
await mkdir(path.join(localDir, 'images'), { recursive: true });
let credentials;
try { credentials = JSON.parse(await readFile(path.join(localDir, 'credentials.json'), 'utf8')); } catch {}
if (!credentials?.accessKey) {
  credentials = { accessKey: randomBytes(32).toString('hex') };
  await writeFile(path.join(localDir, 'credentials.json'), JSON.stringify(credentials));
}
const token = credentials.accessKey;
let loginRecord;
try { loginRecord = JSON.parse(await readFile(path.join(localDir, 'login.json'), 'utf8')); } catch {}
const sessions = new Sessions();
const loginGuard = new LoginGuard();
let state = { active: null, latest: null, error: null };
try { state = JSON.parse(await readFile(path.join(localDir, 'state.json'), 'utf8')); } catch {}
let connected = false;
let submitting = false;
let checking = false;
let socket;
let socketReconnect;
const clientId = randomUUID();
const statePath = path.join(localDir, 'state.json');
const save = () => writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
const json = (res, code, value) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};

async function comfy(route, options = {}, timeout = 15000) {
  let response;
  try {
    response = await fetch(new URL(route, comfyUrl), { ...options, signal: AbortSignal.timeout(timeout) });
  } catch { throw new Error('无法连接 ComfyUI，请保持 Desktop 运行，并检查 config.json 中的地址。'); }
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const error = JSON.parse(body);
      const details = Object.values(error.node_errors || {}).flatMap(node => (node.errors || []).map(e => e.message + (e.details ? `：${e.details}` : '')));
      message = details.join('；') || error.error?.message || body;
    } catch {}
    throw new Error(message.slice(0, 1400) || `ComfyUI 返回 ${response.status}`);
  }
  return response;
}

async function loadWorkflow(character) {
  const original = JSON.parse(await readFile(path.resolve(root, config.workflow), 'utf8'));
  const workflow = prepareWorkflow(original, true, character);
  const info = await (await comfy('/object_info')).json();
  const missing = [...new Set(Object.values(workflow).map(n => n.class_type))].filter(type => !info[type]);
  if (missing.length) throw new Error(`ComfyUI 缺少节点：${missing.join('、')}。请安装后重启 ComfyUI。`);
  await writeFile(path.join(localDir, 'last-submitted-workflow.json'), JSON.stringify(workflow, null, 2));
  return workflow;
}

const DRAW_COUNT = 3;
function publicActive(job) {
  if (!job) return null;
  const { character, results, ...visible } = job;
  return visible;
}
async function submitPicture(character) {
  const workflow = await loadWorkflow(character);
  const response = await comfy('/prompt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId, extra_data: characterRandomMetadata(workflow) })
  });
  const result = await response.json();
  if (!result.prompt_id) throw new Error('ComfyUI 没有返回任务编号。');
  const sampler = Object.values(workflow).find(n => n.class_type === 'KSampler');
  return { promptId: result.prompt_id, seed: sampler?.inputs.seed, cardStartedAt: Date.now(), currentProgress: 0 };
}

function listenProgress() {
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
  const url = new URL('/ws', comfyUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('clientId', clientId);
  socket = new WebSocket(url);
  socket.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    try {
      const { type, data } = JSON.parse(event.data);
      const active = state.active;
      if (!active || data?.prompt_id !== active.promptId) return;
      if (type === 'execution_start') active.stage = '正在准备画笔';
      if (type === 'progress') {
        active.stage = '正在绘制你的画面';
        active.currentProgress = Math.round((data.value / data.max) * 100);
        active.progress = Math.round(((active.completed || 0) * 100 + active.currentProgress) / (active.total || 1));
      }
      if (type === 'executing' && data.node) {
        active.stage = data.node === '18' ? '正在保存图片' : active.stage;
      }
      if (type === 'execution_error' || type === 'execution_interrupted') {
        state.error = data.exception_message || '任务已在 ComfyUI 中被中断。';
        state.active = null;
        save().catch(console.error);
      }
      if (type === 'executed' || (type === 'executing' && data.node === null)) refreshJob();
    } catch {}
  });
  socket.addEventListener('error', () => {});
  socket.addEventListener('close', () => {
    clearTimeout(socketReconnect);
    socketReconnect = setTimeout(listenProgress, 4000);
  });
}

async function refreshJob() {
  if (!state.active || checking) return;
  checking = true;
  const job = state.active;
  let advancing = false;
  try {
    const history = await (await comfy(`/history/${encodeURIComponent(job.promptId)}`)).json();
    connected = true;
    const entry = history[job.promptId];
    if (!entry) {
      const queue = await (await comfy('/queue')).json();
      const running = (queue.queue_running || []).some(row => row[1] === job.promptId);
      const waiting = (queue.queue_pending || []).some(row => row[1] === job.promptId);
      if (running) job.stage = job.progress ? '正在绘制你的画面' : '正在准备画笔';
      else if (waiting) job.stage = '已加入队列，等待画笔';
      else if (Date.now() - (job.cardStartedAt || job.startedAt) > 10000) {
        state.error = '任务已离开 ComfyUI 队列，可能被移除或服务已重启。可以重新生成。';
        state.active = null;
        await save();
      }
      return;
    }
    const error = historyError(entry);
    if (error) throw new Error(error);
    if (!entry.status?.completed) return;
    const images = historyImages(entry);
    if (!images.length) throw new Error('任务结束但没有输出图片，请确认工作流包含“保存图像”节点。');
    const image = images[0];
    const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: 'output' });
    const response = await comfy(`/view?${query}`, {}, 60000);
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) throw new Error('ComfyUI 返回的内容不是图片。');
    if (state.active !== job) return;
    const total = job.total || 1;
    const index = job.completed || 0;
    const imageId = total === 1 ? job.id : `${job.id}-${index + 1}`;
    await writeFile(path.join(localDir, 'images', `${imageId}.image`), bytes);
    if (state.active !== job) return;
    job.results ||= [];
    job.results.push({ id: imageId, seed: job.seed, contentType, imageUrl: `/api/images/${imageId}` });
    job.completed = job.results.length;
    job.progress = Math.round(job.completed / total * 100);
    if (job.completed < total) {
      job.stage = '正在准备下一张卡片';
      advancing = true;
      const next = await submitPicture(job.character);
      if (state.active !== job) return;
      Object.assign(job, next);
      job.stage = '已加入队列，等待画笔';
      await save();
      return;
    }
    state.latest = { id: job.id, completedAt: Date.now(), seconds: Math.round((Date.now() - job.startedAt) / 1000), characterName: job.characterName, images: job.results, ...job.results[0] };
    // The draw ID identifies the whole set; image IDs identify individual files.
    state.latest.id = job.id;
    state.active = null;
    state.error = null;
    await save();
    console.log(`生成完成：${job.promptId}，${state.latest.seconds} 秒`);
  } catch (error) {
    if (state.active !== job) return;
    const unreachable = error.message.startsWith('无法连接');
    if (unreachable) connected = false;
    if (!unreachable || advancing) {
      state.error = error.message;
      state.active = null;
      await save();
      console.error(error.message);
    }
  } finally { checking = false; }
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/remotion-player.js', ['remotion-player.js', 'text/javascript; charset=utf-8']],
  ['/site-config.json', ['site-config.json', 'application/json; charset=utf-8']],
  ['/characters.json', ['characters.json', 'application/json; charset=utf-8']],
  ['/winter.svg', ['winter.svg', 'image/svg+xml']]
]);

const server = http.createServer(async (req, res) => {
  const access = checkRequest(req, { port, token, allowedOrigins: config.allowedOrigins,
    validateToken: (key, localHost) => sessions.valid(key) || (localHost && key === token && !req.headers['cf-ray'] && !req.headers['x-forwarded-for']) });
  for (const [header, value] of Object.entries(access.cors || {})) res.setHeader(header, value);
  if (access.code === 204) { res.writeHead(204); return res.end(); }
  if (access.code !== 200) return json(res, access.code, { error: access.error });
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { service: 'yuki-anima', ready: true, auth: 'password-v1' });
    if (access.login) {
      const ip = req.headers['cf-ray'] ? String(req.headers['cf-connecting-ip'] || 'unknown') : req.socket.remoteAddress;
      const retry = loginGuard.check(ip);
      if (retry) { res.setHeader('Retry-After', String(retry)); return json(res, 429, { error: `尝试次数过多，请 ${Math.ceil(retry / 60)} 分钟后再试。` }); }
      if (!loginRecord) return json(res, 503, { error: '电脑端尚未设置画室密码。' });
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: '请使用网页登录。' });
      let body = ''; let oversized = false;
      for await (const chunk of req) {
        if (Buffer.byteLength(body) + chunk.length > 1024) { oversized = true; break; }
        body += chunk;
      }
      if (oversized) return json(res, 413, { error: '登录请求过大。' });
      let data;
      try { data = JSON.parse(body); } catch { return json(res, 400, { error: '登录请求格式错误。' }); }
      if (!verifyPassword(data.password, loginRecord)) {
        loginGuard.fail(ip);
        return json(res, 401, { error: '密码不正确，请重试。' });
      }
      loginGuard.success(ip);
      return json(res, 200, sessions.issue());
    }
    if (req.method === 'GET' && url.pathname === '/api/session' && access.localSession) return json(res, 200, { accessKey: token });
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, 200, { ...state, active: publicActive(state.active), connected, submitting });
    }
    if (req.method === 'POST' && url.pathname === '/api/generate') {
      if (state.active || submitting) return json(res, 409, { error: '已有图片正在生成，请等待完成。' });
      let body = '';
      for await (const chunk of req) {
        if (Buffer.byteLength(body) + chunk.length > 1024) return json(res, 413, { error: '生成请求过大。' });
        body += chunk;
      }
      let data;
      try { data = JSON.parse(body); } catch { return json(res, 400, { error: '请刷新网页并选择角色后再生成。' }); }
      const characters = parseCharacters(await readFile(path.join(root, '角色.txt'), 'utf8'));
      const character = characters.find(item => item.id === data?.characterId);
      if (!character) return json(res, 400, { error: '请选择角色列表中的一个角色。' });
      // Another request may have acquired the slot while this body was being read.
      if (state.active || submitting) return json(res, 409, { error: '已有图片正在生成，请等待完成。' });
      submitting = true;
      try {
        const first = await submitPicture(character);
        state.active = { id: randomUUID(), ...first, startedAt: Date.now(), total: DRAW_COUNT, completed: 0, results: [], character, progress: 0, stage: '已加入队列，等待画笔', characterId: character.id, characterName: character.name };
        state.error = null;
        connected = true;
        await save();
        console.log(`已提交三张抽卡任务：${first.promptId}`);
        return json(res, 202, publicActive(state.active));
      } finally { submitting = false; }
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/images/')) {
      const id = url.pathname.slice('/api/images/'.length);
      const image = (state.latest?.images || (state.latest ? [state.latest] : [])).find(item => item.id === id);
      if (!image) return json(res, 404, { error: '图片不存在，请重新抽取卡片。' });
      const bytes = await readFile(path.join(localDir, 'images', `${id}.image`));
      res.writeHead(200, { 'Content-Type': image.contentType, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      return res.end(bytes);
    }
    if (req.method === 'GET' && staticFiles.has(url.pathname)) {
      const [file, contentType] = staticFiles.get(url.pathname);
      const bytes = await readFile(path.join(root, 'public', file));
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.end(bytes);
    }
    return json(res, 404, { error: '没有找到这个地址。' });
  } catch (error) {
    console.error(error.message);
    return json(res, 502, { error: error.message });
  }
});

let healthChecking = false;
async function checkHealth() {
  if (healthChecking) return;
  healthChecking = true;
  try { await comfy('/system_stats', {}, 3000); connected = true; } catch { connected = false; }
  finally { healthChecking = false; }
}
await checkHealth();
listenProgress();
const healthTimer = setInterval(checkHealth, 5000);
const jobTimer = setInterval(refreshJob, 1200);
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。已有网页服务时直接打开 http://127.0.0.1:${port}；否则在 config.json 中修改 port。` : error);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  writeFile(path.join(localDir, 'bridge.pid'), String(process.pid)).catch(console.error);
  console.log(`\nYUKI / ANIMA 本地画室\n网页：http://127.0.0.1:${port}\nComfyUI：${comfyUrl.origin}\n按 Ctrl+C 停止网页服务。\n`);
});
function stop() {
  clearInterval(healthTimer); clearInterval(jobTimer); clearTimeout(socketReconnect);
  if (socket) socket.close();
  server.close();
  setTimeout(() => process.exit(0), 200).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
