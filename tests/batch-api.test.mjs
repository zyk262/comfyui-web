import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCharacters } from '../characters.mjs';

async function fixture() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const local = await mkdtemp(path.join(os.tmpdir(), 'yuki-batch-'));
  const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
  const workflow = JSON.parse(await readFile(path.join(root, config.workflow), 'utf8'));
  const character = parseCharacters(await readFile(path.join(root, '角色.txt'), 'utf8'))[0];
  const submissions = [], histories = new Map();
  const comfy = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/prompt') {
      let body = ''; for await (const chunk of req) body += chunk;
      submissions.push(JSON.parse(body));
      return res.end(JSON.stringify({ prompt_id: `card-${submissions.length}` }));
    }
    if (req.url === '/object_info') return res.end(JSON.stringify(Object.fromEntries(Object.values(workflow).map(n => [n.class_type, {}]))));
    if (req.url.startsWith('/history/')) {
      const id = req.url.slice('/history/'.length);
      return res.end(JSON.stringify(histories.has(id) ? { [id]: histories.get(id) } : {}));
    }
    if (req.url === '/queue') return res.end(JSON.stringify({ queue_pending: submissions.map((_,i) => [i,`card-${i+1}`]), queue_running: [] }));
    if (req.url.startsWith('/view?')) {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="pink"/></svg>');
    }
    res.end('{}');
  });
  await new Promise(resolve => comfy.listen(0, '127.0.0.1', resolve));
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, windowsHide: true,
    env: { ...process.env, PORT: String(port), COMFY_URL: `http://127.0.0.1:${comfy.address().port}`, YUKI_LOCAL_DIR: local }, stdio: 'ignore' });
  const origin = `http://127.0.0.1:${port}`;
  const wait = async predicate => {
    for (let i=0;i<150;i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve,50)); }
    throw new Error('Fixture condition timed out');
  };
  const cleanup = async () => {
    child.kill('SIGTERM');
    if (child.exitCode === null) await new Promise(resolve => child.once('exit',resolve));
    await new Promise(resolve => comfy.close(resolve));
    await rm(local,{ recursive:true,force:true });
  };
  try {
    await wait(async () => { try { return (await fetch(origin+'/health')).ok; } catch { return false; } });
    const session = await (await fetch(origin+'/api/session',{ headers:{'X-Yuki-Request':'1','Sec-Fetch-Site':'same-origin'} })).json();
    const headers = { Authorization:`Bearer ${session.accessKey}`,'X-Yuki-Request':'1','Content-Type':'application/json' };
    return {
      submissions, histories, wait, cleanup,
      request: route => fetch(origin+route,{headers}),
      state: async () => (await fetch(origin+'/api/state',{headers})).json(),
      generate: () => fetch(origin+'/api/generate',{method:'POST',headers,body:JSON.stringify({characterId:character.id})}),
      finish(index) { histories.set(`card-${index}`,{status:{completed:true},outputs:{'18':{images:[{filename:`${index}.svg`,type:'output'}]}}}); }
    };
  } catch (error) { await cleanup(); throw error; }
}

test('one draw submits three independent pictures sequentially and publishes no partial set', {timeout:15000}, async () => {
  const f = await fixture();
  try {
    const response = await f.generate();
    assert.equal(response.status,202);
    const job = await response.json();
    assert.equal(job.total,3); assert.equal(job.completed,0);
    assert.equal(job.character,undefined); assert.equal(job.results,undefined);
    assert.equal((await f.generate()).status,409);
    for (let index=1;index<=3;index++) {
      assert.equal(f.submissions.length,index,'only one picture is queued at a time');
      f.finish(index);
      await f.wait(async () => index<3 ? f.submissions.length===index+1 : Boolean((await f.state()).latest));
      if (index<3) {
        const state=await f.state();
        assert.equal(state.latest,null);
        assert.equal(state.active.completed,index);
        assert.equal(state.active.results,undefined);
        assert.equal((await f.request(`/api/images/${job.id}-1`)).status,404);
      }
    }
    const state=await f.state();
    assert.equal(state.active,null); assert.equal(state.latest.id,job.id);
    assert.equal(state.latest.images.length,3);
    const seeds=f.submissions.map(body=>Object.values(body.prompt).find(n=>n.class_type==='KSampler').inputs.seed);
    assert.equal(new Set(seeds).size,3);
    const prompts=f.submissions.map(body=>Object.values(body.prompt).find(n=>n.class_type==='AnimaPromptPlusClipEncode').inputs.character_tags);
    assert.equal(new Set(prompts).size,1,'selected character is held across the whole set');
    for (const image of state.latest.images) assert.equal((await f.request(image.imageUrl)).status,200);
    assert.equal((await f.request('/api/images/not-a-card')).status,404);
  } finally { await f.cleanup(); }
});

test('a failed second picture releases the draw without exposing incomplete results', {timeout:15000}, async () => {
  const f=await fixture();
  try {
    const job=await (await f.generate()).json();
    f.finish(1); await f.wait(async()=>f.submissions.length===2);
    f.histories.set('card-2',{status:{status_str:'error',messages:[['execution_error',{exception_message:'fixture failure'}]]}});
    await f.wait(async()=>!(await f.state()).active);
    const state=await f.state();
    assert.equal(state.latest,null); assert.match(state.error,/fixture failure/);
    assert.equal(f.submissions.length,2);
    assert.equal((await f.request(`/api/images/${job.id}-1`)).status,404);
    assert.equal((await f.generate()).status,202,'a failed set must not permanently lock Generate');
  } finally { await f.cleanup(); }
});
