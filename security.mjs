import { timingSafeEqual } from 'node:crypto';

export function checkRequest(req, { port, token, allowedOrigins = [] }) {
  const localHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  const host = req.headers.host || '';
  const localHost = localHosts.includes(host);
  const remoteHost = /^[a-z0-9-]+\.trycloudflare\.com(?::443)?$/i.test(host);
  if (!localHost && !remoteHost) return { code: 403, error: '无效的画室访问地址。' };
  const origin = req.headers.origin;
  const origins = new Set([...allowedOrigins, ...localHosts.map(h => `http://${h}`)]);
  if (origin && !origins.has(origin)) return { code: 403, error: '这个网页不在允许连接的来源中。' };
  const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, X-Yuki-Request, Content-Type', 'Access-Control-Max-Age': '600' } : {};
  if (req.method === 'OPTIONS') return { code: 204, cors };
  const route = new URL(req.url, 'http://127.0.0.1').pathname;
  if (!route.startsWith('/api/')) return { code: 200, cors };
  if (route === '/api/session') {
    const forwarded = ['cf-ray', 'cf-connecting-ip', 'x-forwarded-for', 'x-forwarded-host'].some(h => req.headers[h]);
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
    if (localHost && loopback && !forwarded && req.headers['sec-fetch-site'] === 'same-origin' && req.headers['x-yuki-request'] === '1') return { code: 200, cors, localSession: true };
    return { code: 403, cors, error: '远程连接需要使用私人链接或输入访问口令。' };
  }
  const incoming = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(token);
  if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) return { code: 401, cors, error: '访问口令不正确，请连接你的画室。' };
  if (req.method === 'POST' && req.headers['x-yuki-request'] !== '1') return { code: 403, cors, error: '缺少网页请求标记。' };
  return { code: 200, cors };
}
