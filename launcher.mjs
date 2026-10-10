import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const local = path.join(root, '.local');
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
const remote = process.argv.includes('--remote');
const noOpen = process.argv.includes('--no-open');
const localUrl = `http://127.0.0.1:${config.port}`;
await mkdir(path.join(local, 'bin'), { recursive: true });
const children = [];
let stopping = false;
let publicUrl;
let bridgePid;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function healthy() {
  try {
    const response = await fetch(`${localUrl}/health`, { signal: AbortSignal.timeout(1500) });
    return (await response.json()).service === 'yuki-anima';
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
  const { accessKey } = JSON.parse(await readFile(path.join(local, 'credentials.json'), 'utf8'));
  const site = remote ? config.pagesUrl : `${localUrl}/`;
  const fragment = new URLSearchParams({ bridge, key: accessKey }).toString();
  const privateLink = `${site}#${fragment}`;
  await writeFile(path.join(local, 'connection.json'), JSON.stringify({ bridgeUrl: bridge, pagesUrl: config.pagesUrl, privateLink }, null, 2));
  await writeFile(path.join(local, 'private-link.txt'), privateLink + '\n');
  const escaped = privateLink.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>打开雪间画室</title><style>body{background:#f3eff8;color:#645577;font:16px "Microsoft YaHei",sans-serif;text-align:center;padding:60px 25px}a{display:inline-block;color:#fff;background:#a38ec0;padding:16px 28px;border-radius:16px;text-decoration:none}textarea{display:block;width:min(700px,90%);height:110px;margin:25px auto;border:1px solid #ddd0e9;padding:12px;border-radius:12px;color:#746184}p{font-size:13px;line-height:2}</style><h1>雪间画室已经连接</h1><p>点击打开网页。手机可以复制下方的私人链接访问。<br>链接包含访问口令，请只发送给自己。</p><a href="${escaped}">打开雪间画室 ↗</a><textarea readonly aria-label="手机私人访问链接">${escaped}</textarea></html>`;
  const connectionPage = path.join(local, 'connect.html');
  await writeFile(connectionPage, html);
  await writeFile(path.join(local, 'runtime.json'), JSON.stringify({ supervisorPid: process.pid, bridgePid, tunnelPid: remote ? children.at(-1)?.pid : null, startedAt: new Date().toISOString(), bridgeUrl: bridge }));
  console.log(`\n${remote ? 'Remote' : 'Local'} atelier is ready.\nWebsite: ${site}\nBridge: ${bridge}\nPrivate connection page: ${connectionPage}\nPhone link: ${path.join(local, 'private-link.txt')}\nKeep this window open. Press Ctrl+C to stop.\n`);
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
  await writeConnection(publicUrl);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.reverse()) child.kill();
  setTimeout(() => process.exit(code), 400);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
start().catch(error => { console.error(error.message); stop(1); });
