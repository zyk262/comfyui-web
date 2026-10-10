import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPublisher, connectionRecord } from './publisher.mjs';
import { enableProxy } from './network.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const local = path.join(root, '.local');
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
const remote = process.argv.includes('--remote');
const noOpen = process.argv.includes('--no-open');
// Development mode when a connector publishes the test address separately.
const manualPublish = process.argv.includes('--manual-publish');
const localUrl = `http://127.0.0.1:${config.port}`;
await mkdir(path.join(local, 'bin'), { recursive: true });
const children = [];
let stopping = false;
let publicUrl;
let bridgePid;
let publisher, currentRecord, heartbeat;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function healthy() {
  try {
    const response = await fetch(`${localUrl}/health`, { signal: AbortSignal.timeout(1500) });
    const health = await response.json();
    return health.service === 'yuki-anima' && health.auth === 'password-v1';
  } catch { return false; }
}

function launch(command, args, name) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const log = createWriteStream(path.join(local, `${name}.log`), { flags: 'w' });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => log.write(data));
  child.on('error', error => { console.error(`${name}: ${error.message}`); stop(1); });
  child.on('exit', code => {
    log.end();
    if (!stopping) { console.error(`${name} stopped (${code}). Run the launcher again to reconnect.`); stop(code || 0); }
  });
  return child;
}

async function writeConnection(bridge) {
  const site = remote ? config.pagesUrl : `${localUrl}/`;
  await writeFile(path.join(local, 'connection.json'), JSON.stringify({ bridgeUrl: bridge, pagesUrl: config.pagesUrl }, null, 2));
  await writeFile(path.join(local, 'private-link.txt'), site + '\n');
  const escaped = site.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>打开雪间画室</title><style>body{background:#f3eff8;color:#645577;font:16px "Microsoft YaHei",sans-serif;text-align:center;padding:60px 25px}a{display:inline-block;color:#fff;background:#a38ec0;padding:16px 28px;border-radius:16px;text-decoration:none}p{font-size:14px;line-height:2}</style><h1>雪间画室已经启动</h1><p>电脑与 ComfyUI 保持运行。<br>手机打开固定网页，输入画室密码即可。</p><a href="${escaped}">打开雪间画室 ↗</a><p>${escaped}</p></html>`;
  const connectionPage = path.join(local, 'connect.html');
  await writeFile(connectionPage, html);
  await writeFile(path.join(local, 'runtime.json'), JSON.stringify({ supervisorPid: process.pid, bridgePid, tunnelPid: remote ? children.at(-1)?.pid : null, startedAt: new Date().toISOString(), bridgeUrl: bridge }));
  console.log(`\n${remote ? 'Remote' : 'Local'} atelier is ready.\nWebsite: ${site}\nOpen this fixed URL on your phone and enter the studio password.\nKeep this window open. Press Ctrl+C to stop.\n`);
  if (!noOpen) {
    // The helper stays hidden; the browser is the interactive user-facing tool.
    spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${connectionPage.replaceAll("'", "''")}'`], { windowsHide: true, stdio: 'ignore' });
  }
}

async function cloudflaredPath() {
  const executable = path.join(local, 'bin', 'cloudflared.exe');
  try { await access(executable); return executable; } catch {}
  console.log('Downloading cloudflared from the official Cloudflare GitHub release...');
  const response = await fetch('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe');
  if (!response.ok) throw new Error(`cloudflared download failed: ${response.status}`);
  await writeFile(executable, Buffer.from(await response.arrayBuffer()));
  return executable;
}

async function start() {
  await enableProxy(config.proxyUrl);
  try { await access(path.join(local, 'login.json')); }
  catch { throw new Error('Studio password is not configured. Check .local/login.json.'); }
  if (remote && !manualPublish) {
    try { publisher = await createPublisher(config); }
    catch (error) {
      if (!noOpen && process.stdin.isTTY && error.message.startsWith('One-time')) {
        console.log('Please complete the one-time GitHub setup in this window.');
        const setup = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'setup-github.ps1')], { cwd: root, windowsHide: true, stdio: 'inherit' });
        const code = await new Promise(resolve => { setup.on('error', () => resolve(1)); setup.on('exit', resolve); });
        if (code !== 0) throw new Error('One-time GitHub setup did not finish. Run setup-github.cmd.');
        publisher = await createPublisher(config);
      } else throw error;
    }
    await publisher.verify();
  }
  if (manualPublish) console.warn('Development mode: the address must be published separately.');
  if (!(await healthy())) {
    bridgePid = launch(process.execPath, [path.join(root, 'server.mjs')], 'bridge').pid;
    for (let i = 0; i < 30 && !(await healthy()); i++) await sleep(500);
    if (!(await healthy())) throw new Error('Local bridge did not start. Check .local/bridge.log.');
  } else {
    console.log('Using the existing local bridge.');
    try { bridgePid = Number(await readFile(path.join(local, 'bridge.pid'), 'utf8')); } catch {}
  }
  if (!remote) return writeConnection(localUrl);
  const binary = await cloudflaredPath();
  const tunnel = launch(binary, ['tunnel', '--url', localUrl, '--no-autoupdate', '--protocol', 'http2'], 'tunnel');
  let output = '';
  for (const stream of [tunnel.stdout, tunnel.stderr]) stream.on('data', data => {
    output = (output + data.toString()).slice(-30000);
    publicUrl ||= output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  });
  for (let i = 0; i < 120 && !publicUrl && !stopping; i++) await sleep(500);
  if (!publicUrl) throw new Error('HTTPS tunnel did not start. Check .local/tunnel.log.');
  currentRecord = connectionRecord(publicUrl);
  if (publisher) {
    await publisher.publish(currentRecord);
    console.log('Published the new address automatically. The website URL stays the same.');
    heartbeat = setInterval(() => {
      currentRecord = connectionRecord(publicUrl);
      publisher.publish(currentRecord).catch(error => console.error(error.message));
    }, 8 * 60 * 60 * 1000);
  }
  await writeConnection(publicUrl);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  for (const child of children.reverse()) child.kill();
  if (publisher && currentRecord) {
    const offline = { ...currentRecord, online: false, updatedAt: new Date().toISOString() };
    Promise.race([publisher.publish(offline).catch(() => {}), sleep(3000)]).finally(() => process.exit(code));
  } else setTimeout(() => process.exit(code), 400);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
start().catch(error => { console.error(error.message); stop(1); });
