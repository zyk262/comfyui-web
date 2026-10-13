import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const image = id => ({ id, imageUrl: `/api/images/${id}`, seconds: 12 });
const idle = latest => ({ active: null, latest, connected: true });

async function browser({ reduced = true } = {}) {
  const elements = new Map();
  const downloads = [], decodes = [], revoked = [];
  let state = idle(null), pendingState;
  let clock = Date.now(), timerId = 0;
  const timers = new Map();
  class ClockDate extends Date { static now() { return clock; } }
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, disabled: false, textContent: '', style: { setProperty() {} }, listeners: {}, children: [],
      classList: { toggle() {}, remove() {} },
      append(...children) { this.children.push(...children); }, setAttribute() {},
      replaceChildren(...children) { this.children = children; },
      removeAttribute(name) { delete this[name]; },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      showModal() { this.open = true; }, close() { this.open = false; },
      getContext() { return { setTransform() {} }; }
    });
    return elements.get(id);
  }
  class BrowserURL extends URL {
    static createObjectURL(blob) { return `blob:${blob.id}`; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  const context = vm.createContext({
    URL: BrowserURL, AbortSignal, AbortController, console, Date: ClockDate,
    location: { hostname: 'localhost', origin: 'http://localhost:3210', pathname: '/', hash: '' },
    sessionStorage: { getItem: () => JSON.stringify({ bridge: 'http://localhost:3210', key: 'test-session' }), setItem() {} },
    document: { getElementById: element, createElement: () => element('button-' + elements.size), hidden: false, addEventListener() {} },
    Image: class { decode() { const pending = deferred(); decodes.push(pending); return pending.promise; } },
    fetch: async url => {
      const path = new URL(url, 'http://localhost:3210').pathname;
      if (path === '/characters.json') return { ok: true, json: async () => [{ id: 'test-character', name: '测试角色' }] };
      if (path.startsWith('/api/images/')) {
        const pending = deferred(); downloads.push({ ...pending, url }); return pending.promise;
      }
      if (path === '/api/generate') return { ok: true, json: async () => ({ id: 'new-job', stage: '绘制中', startedAt: Date.now() }) };
      if (pendingState) { const pending = pendingState; pendingState = null; return pending.promise; }
      return { ok: true, json: async () => state };
    },
    setInterval() {}, addEventListener() {}, requestAnimationFrame() {}, cancelAnimationFrame() {},
    setTimeout(fn, delay) { const id=++timerId; timers.set(id,{ fn,at:clock+delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    matchMedia: () => ({ matches: reduced, addEventListener() {} }), innerWidth: 900, innerHeight: 800, devicePixelRatio: 1
  });
  vm.runInContext(source + '\n globalThis.app = { render, refresh, resetImage, reconnect() { connectionVersion++; resetImage(); } };', context);
  await tick();
  return {
    app: context.app, element, downloads, decodes, revoked,
    now: () => clock,
    timerCount: () => timers.size,
    advance(ms) { clock+=ms; for(const[id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();} },
    shown() { return element('result').children.map(card => card.children[0].children[1].children[0].src); },
    card(index) { return element('result').children[index]; },
    setState(value) { state = value; },
    delayState() { pendingState = deferred(); return pendingState; },
    async finishDownload(index, id, type = 'image/png') {
      downloads[index].resolve({ ok: true, blob: async () => ({ id, type }) }); await tick();
    },
    async showFirst() {
      this.app.render(idle(image('old')));
      await this.finishDownload(0, 'old'); decodes[0].resolve(); await tick();
      element('view').listeners.click();
    }
  };
}

test('old image stays hidden through slow transfer and decode; repeated polls fetch once', async () => {
  const b = await browser();
  await b.showFirst();
  assert.equal(b.element('result').hidden, false);
  b.app.render({ ...idle(image('old')), active: { id: 'new', stage: '绘制中', progress: 90 } });
  assert.equal(b.element('result').hidden, true);
  assert.equal(b.element('view').disabled, true);
  b.setState(idle(image('new')));
  await b.app.refresh(); await b.app.refresh();
  assert.equal(b.downloads.length, 2);
  assert.equal(b.element('drawing-overlay').hidden, false);
  assert.match(b.element('status-text').textContent, /正在加载新图片/);
  await b.finishDownload(1, 'new');
  await b.app.refresh();
  assert.equal(b.downloads.length, 2, 'decode also holds the single-flight lock');
  assert.equal(b.element('result').hidden, true);
  assert.equal(b.element('full-image').src, 'blob:old');
  b.decodes[1].resolve(); await tick();
  assert.deepEqual(b.shown(), ['blob:new']);
  b.card(0).listeners.click();
  assert.equal(b.element('full-image').src, 'blob:new');
  assert.equal(b.element('result').hidden, false);
  assert.equal(b.element('drawing-overlay').hidden, true);
  assert.equal(b.element('view').disabled, false);
  assert.match(b.element('status-text').textContent, /画好了/);
  assert.deepEqual(b.revoked, ['blob:old']);
});

test('late decoded image cannot replace a newer result or cross a reconnection', async () => {
  const b = await browser();
  b.app.render(idle(image('obsolete')));
  await b.finishDownload(0, 'obsolete');
  b.app.render(idle(image('new')));
  b.decodes[0].resolve(); await tick();
  assert.deepEqual(b.shown(), []);
  assert.ok(b.revoked.includes('blob:obsolete'));
  await b.finishDownload(1, 'new');
  b.app.reconnect();
  b.decodes[1].resolve(); await tick();
  assert.equal(b.element('result').hidden, true);
  assert.equal(b.element('view').disabled, true);
  assert.ok(b.revoked.includes('blob:new'));
});

test('three cards are committed together only after every download and decode, and each opens its own image', async () => {
  const b = await browser();
  const draw = { id: 'triple', seconds: 30, characterName: '测试角色', images: [image('a'), image('b'), image('c')] };
  b.setState(idle(draw));
  b.app.render(idle(draw));
  await b.app.refresh();
  assert.equal(b.downloads.length, 3);
  for (let n = 0; n < 3; n++) await b.finishDownload(n, ['a','b','c'][n]);
  b.decodes[0].resolve(); b.decodes[1].resolve(); await tick();
  assert.equal(b.element('result').hidden, true);
  assert.equal(b.element('view').disabled, true);
  assert.deepEqual(b.shown(), []);
  b.app.render(idle(draw));
  assert.equal(b.downloads.length, 3, 'polling must not start another set during decode');
  b.decodes[2].resolve(); await tick();
  assert.deepEqual(b.shown(), ['blob:a','blob:b','blob:c']);
  assert.equal(b.element('result').hidden, false);
  const first = b.card(0);
  b.app.render(idle(draw));
  assert.equal(b.card(0), first, 'polling must not rebuild the deck or replay the flip');
  b.card(1).listeners.click();
  assert.equal(b.element('full-image').src, 'blob:b');
  assert.match(b.element('viewer-caption').textContent, /02 \/ 3/);
});

test('fast pictures wait for the ten-second draw and polling neither restarts the timer nor downloads another set', async () => {
  const b=await browser({reduced:false});
  const draw={id:'fast',seconds:1,images:[image('a'),image('b'),image('c')]};
  b.app.render({active:{id:'fast',startedAt:b.now(),stage:'绘制中'},latest:null,connected:true});
  b.app.render(idle(draw));
  for(let n=0;n<3;n++)await b.finishDownload(n,['a','b','c'][n]);
  for(const decode of b.decodes)decode.resolve(); await tick();
  b.app.render(idle(draw)); b.advance(9999); await tick();
  assert.deepEqual(b.shown(),[]);
  assert.equal(b.element('result').hidden,true);
  assert.equal(b.element('view').disabled,true);
  assert.equal(b.downloads.length,3);
  assert.equal(b.timerCount(),1);
  b.advance(1); await tick();
  assert.deepEqual(b.shown(),['blob:a','blob:b','blob:c']);
  assert.equal(b.element('result').hidden,false);
  assert.equal(b.timerCount(),0);
});

test('a slower generation completes after the draw without starting another ten-second wait', async () => {
  const b=await browser({reduced:false});
  const job={id:'slow',startedAt:b.now(),stage:'绘制中'};
  b.app.render({active:job,latest:null,connected:true});
  b.advance(12000); await tick();
  b.app.render({active:job,latest:null,connected:true});
  assert.equal(b.timerCount(),0);
  assert.equal(b.element('drawing-overlay').hidden,false);
  b.app.render(idle(image('slow')));
  await b.finishDownload(0,'slow'); b.decodes[0].resolve(); await tick();
  assert.deepEqual(b.shown(),['blob:slow']);
  assert.equal(b.element('result').hidden,false);
});

test('reconnecting during the draw cancels the delayed reveal and releases decoded images', async () => {
  const b=await browser({reduced:false});
  b.app.render({active:{id:'retired',startedAt:b.now(),stage:'绘制中'},latest:null,connected:true});
  b.app.render(idle(image('retired')));
  await b.finishDownload(0,'retired'); b.decodes[0].resolve(); await tick();
  b.app.reconnect(); await tick(); b.advance(10000); await tick();
  assert.equal(b.timerCount(),0);
  assert.deepEqual(b.shown(),[]);
  assert.equal(b.element('result').hidden,true);
  assert.ok(b.revoked.includes('blob:retired'));
});

test('viewer navigation wraps, keyboard switching follows the current card, and download uses its original blob and file type', async () => {
  const b=await browser();
  const draw={id:'set12345',characterName:'测试角色',seconds:20,images:[image('a'),image('b'),image('c')]};
  b.app.render(idle(draw));
  await b.finishDownload(0,'a','image/jpeg');
  await b.finishDownload(1,'b','image/png');
  await b.finishDownload(2,'c','image/webp');
  for(const decode of b.decodes)decode.resolve(); await tick();
  b.card(0).listeners.click();
  assert.equal(b.element('download-image').href,'blob:a');
  assert.match(b.element('download-image').download,/01\.jpg$/);
  b.element('viewer-prev').listeners.click();
  assert.equal(b.element('full-image').src,'blob:c');
  assert.equal(b.element('download-image').href,'blob:c');
  assert.match(b.element('download-image').download,/03\.webp$/);
  b.element('viewer-next').listeners.click();
  assert.equal(b.element('full-image').src,'blob:a');
  let prevented=false;
  b.element('viewer').listeners.keydown({key:'ArrowRight',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(b.element('full-image').src,'blob:b');
  assert.match(b.element('viewer-caption').textContent,/02 \/ 3/);
  assert.equal(b.element('download-image').href,'blob:b');
  assert.equal(b.element('viewer-prev').disabled,false);
  b.app.reconnect();
  assert.equal(b.element('viewer').open,false);
  assert.equal(b.element('download-image').href,undefined,'retired session must not retain a download link');
});

test('failed decode never reports completion or exposes old image, and next poll retries', async () => {
  const b = await browser();
  await b.showFirst();
  b.app.render(idle(image('new')));
  await b.finishDownload(1, 'broken');
  b.decodes[1].reject(new Error('无法解码图片')); await tick();
  assert.equal(b.element('result').hidden, true);
  assert.equal(b.element('view').disabled, true);
  assert.doesNotMatch(b.element('status-text').textContent, /画好了/);
  assert.equal(b.element('error').hidden, false);
  assert.ok(b.revoked.includes('blob:broken'));
  b.app.render(idle(image('new')));
  assert.equal(b.downloads.length, 3);
  await b.finishDownload(2, 'new'); b.decodes[2].resolve(); await tick();
  assert.equal(b.element('result').hidden, false);
  assert.equal(b.element('error').hidden, true);
});

test('one broken card cannot reveal the other two and all temporary image URLs are released', async () => {
  const b=await browser();
  const draw={id:'broken-set',seconds:15,images:[image('a'),image('b'),image('c')]};
  b.app.render(idle(draw));
  for(let index=0;index<3;index++)await b.finishDownload(index,['a','b','c'][index]);
  b.decodes[0].resolve(); b.decodes[1].reject(new Error('bad card')); b.decodes[2].resolve(); await tick();
  assert.deepEqual(b.shown(),[]);
  assert.equal(b.element('result').hidden,true);
  assert.equal(b.element('view').disabled,true);
  assert.equal(b.element('error').hidden,false);
  assert.deepEqual(b.revoked.sort(),['blob:a','blob:b','blob:c']);
  b.app.render(idle(draw));
  assert.equal(b.downloads.length,6,'retry loads a complete new set');
});

test('a state poll started before Generate cannot flash the previous result after submission', async () => {
  const b = await browser();
  await b.showFirst();
  const pending = b.delayState();
  const poll = b.app.refresh();
  await b.element('generate').listeners.click();
  pending.resolve({ ok: true, json: async () => idle(image('old')) });
  await poll;
  assert.equal(b.element('result').hidden, true);
  assert.equal(b.element('drawing-overlay').hidden, false);
  assert.equal(b.element('view').disabled, true);
  assert.match(b.element('status-text').textContent, /正在召唤/);
});
