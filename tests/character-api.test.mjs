import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCharacters, QUALITY_PROMPT } from '../characters.mjs';

test('authenticated Generate validates the character ID and sends catalog prompts plus plugin random switches', { timeout: 15000 }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const catalog = parseCharacters(await readFile(path.join(root, '角色.txt'), 'utf8'));
  const selected = catalog[0];
  const local = await mkdtemp(path.join(os.tmpdir(), 'yuki-character-api-'));
  let submitted;
  const comfy = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/prompt') {
      let body = ''; for await (const chunk of req) body += chunk;
      submitted = JSON.parse(body); return res.end(JSON.stringify({ prompt_id: 'fixture-job' }));
    }
    if (req.url === '/object_info') {
      const workflow = JSON.parse(await readFile(path.join(root, 'anima turbo.json'), 'utf8'));
      return res.end(JSON.stringify(Object.fromEntries(Object.values(workflow).map(node => [node.class_type, {}]))));
    }
    if (req.url === '/queue') return res.end(JSON.stringify({ queue_pending: [[0, 'fixture-job']], queue_running: [] }));
    res.end('{}');
  });
  await new Promise(resolve => comfy.listen(0, '127.0.0.1', resolve));
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, windowsHide: true,
    env: { ...process.env, PORT: String(port), COMFY_URL: `http://127.0.0.1:${comfy.address().port}`, YUKI_LOCAL_DIR: local }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  try {
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try { ready = (await fetch(origin + '/health', { signal: AbortSignal.timeout(200) })).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(ready, logs);
    const session = await (await fetch(origin + '/api/session', { headers: { 'X-Yuki-Request': '1', 'Sec-Fetch-Site': 'same-origin' } })).json();
    assert.ok(session.accessKey);
    const headers = { Authorization: `Bearer ${session.accessKey}`, 'X-Yuki-Request': '1', 'Content-Type': 'application/json' };
    const request = body => fetch(origin + '/api/generate', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal((await request({ characterId: '不存在的角色' })).status, 400);
    assert.equal((await request({})).status, 400);
    assert.equal(submitted, undefined);
    const response = await request({ characterId: selected.id, character_tags: 'untrusted override', quality_prompt: 'untrusted override' });
    assert.equal(response.status, 202, await response.clone().text());
    assert.equal((await response.json()).characterName, selected.name);
    const [id, plus] = Object.entries(submitted.prompt).find(([, node]) => node.class_type === 'AnimaPromptPlusClipEncode');
    assert.equal(plus.inputs.character_tags, selected.prompt);
    assert.equal(plus.inputs.quality_prompt, QUALITY_PROMPT);
    const metadata = submitted.extra_data.extra_pnginfo.workflow.nodes.find(node => String(node.id) === id);
    assert.deepEqual(metadata.properties.anima_selector_random, { artist: true, character: false, clothing: true, pose: true, background: true });
    const published = await fetch(origin + '/characters.json');
    assert.equal(published.status, 200);
    assert.deepEqual(await published.json(), catalog.map(({ id, name }) => ({ id, name })));
    assert.equal((await request({ characterId: selected.id })).status, 409);
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    await new Promise(resolve => comfy.close(resolve));
    // mkdtemp creates a known disposable test directory, never production state.
    await rm(local, { recursive: true, force: true });
  }
});
