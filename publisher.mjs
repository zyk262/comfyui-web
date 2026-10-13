import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enableProxy } from './network.mjs';

const exec = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));

export function connectionRecord(bridgeUrl, now = Date.now()) {
  const url = new URL(bridgeUrl);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/i.test(url.hostname) || url.username || url.password) throw new Error('Invalid HTTPS tunnel address.');
  return { version: 1, online: true, bridgeUrl: url.origin, updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString() };
}

export async function readGithubToken() {
  const credentialPath = path.join(root, '.local', 'github-token.dpapi');
  let encrypted;
  try { encrypted = (await readFile(credentialPath, 'utf8')).trim(); } catch {}
  if (encrypted) {
    // Keep even the encrypted credential out of process command lines.
    const escapedPath = credentialPath.replaceAll("'", "''");
    const script = `$ErrorActionPreference = 'Stop'; $cipher = (Get-Content -LiteralPath '${escapedPath}' -Raw).Trim(); $secure = ConvertTo-SecureString $cipher; $plain = [System.Net.NetworkCredential]::new('', $secure).Password; [Console]::Write($plain)`;
    try {
      const windowsEnvironment = { ...process.env };
      // PowerShell 7 module paths cannot be loaded by Windows PowerShell 5.1.
      // Let powershell.exe restore its own built-in modules when Node was
      // launched from pwsh instead of a normal Command Prompt.
      delete windowsEnvironment.PSModulePath;
      const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 10000, env: windowsEnvironment });
      if (stdout.trim()) return stdout.trim();
    } catch { throw new Error('Windows could not decrypt the saved GitHub credential. Run the launcher under the Windows account used for setup.'); }
    throw new Error('The saved GitHub credential is empty. Run setup-github.cmd again.');
  }
  // Reuse an existing Git credential, without starting an interactive login.
  try {
    const token = await new Promise(resolve => {
      const child = execFile('git', ['credential', 'fill'], { windowsHide: true, timeout: 10000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } }, (error, stdout) => {
        resolve(error ? '' : stdout.split('\n').find(line => line.startsWith('password='))?.slice(9).trim() || '');
      });
      child.stdin.end('protocol=https\nhost=github.com\n\n');
    });
    if (token) return token;
  } catch {}
  throw new Error('One-time GitHub authorization is required. Run setup-github.cmd first.');
}

export async function createPublisher(config) {
  await enableProxy(config.proxyUrl);
  const token = await readGithubToken();
  const { repository, branch, path: filePath } = config.discovery;
  const base = `https://api.github.com/repos/${repository}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      // Never print API response bodies, which could contain credential details.
      const detail = [401, 403].includes(response.status) ? ' Check token expiry and Contents: read and write permission for this repository.' : '';
      throw new Error(`GitHub address update failed (${response.status}).${detail}`);
    }
    return response.status === 204 ? null : response.json();
  }
  const repo = await request(base);
  if (!repo.permissions?.push) throw new Error('The GitHub token has no write access to this repository.');
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const readUrl = `${base}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  let publishing = false;
  return {
    async publish(record) {
      if (publishing) return;
      publishing = true;
      try {
        const current = await request(readUrl);
        await request(`${base}/contents/${encodedPath}`, { method: 'PUT', body: JSON.stringify({
          branch, sha: current.sha, message: record.online ? 'Update active atelier address' : 'Mark atelier offline',
          content: Buffer.from(JSON.stringify(record, null, 2) + '\n').toString('base64')
        }) });
      } finally { publishing = false; }
    },
    async verify() { await request(readUrl); return true; }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
    const publisher = await createPublisher(config);
    await publisher.verify();
    console.log('GitHub connection configured. Double-click 启动.cmd next.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
