import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRequest } from '../security.mjs';
const options = { port: 3210, token: 'test-secret', allowedOrigins: ['https://zyk262.github.io'] };
function request(headers = {}, route = '/api/state', method = 'GET') { return { method, url: route, headers: { host: 'gentle-snow.trycloudflare.com', ...headers }, socket: { remoteAddress: '127.0.0.1' } }; }
test('remote API and images always require a valid key', () => {
  assert.equal(checkRequest(request(), options).code, 401);
  assert.equal(checkRequest(request({}, '/api/images/abc'), options).code, 401);
  assert.equal(checkRequest(request({ authorization: 'Bearer wrong' }), options).code, 401);
  assert.equal(checkRequest(request({ authorization: 'Bearer test-secret', origin: 'https://zyk262.github.io' }), options).code, 200);
});
test('CORS is limited to the owned Pages origin, including preflight', () => {
  assert.equal(checkRequest(request({ origin: 'https://example.com', authorization: 'Bearer test-secret' }), options).code, 403);
  const result = checkRequest(request({ origin: 'https://zyk262.github.io' }, '/api/generate', 'OPTIONS'), options);
  assert.equal(result.code, 204);
  assert.equal(result.cors['Access-Control-Allow-Origin'], 'https://zyk262.github.io');
});
test('local token bootstrap cannot be accessed via the tunnel or a cross-site request', () => {
  const headers = { host: '127.0.0.1:3210', 'sec-fetch-site': 'same-origin', 'x-yuki-request': '1' };
  assert.equal(checkRequest(request(headers, '/api/session'), options).localSession, true);
  assert.equal(checkRequest(request({ ...headers, 'cf-ray': 'forwarded' }, '/api/session'), options).code, 403);
  assert.equal(checkRequest(request({ ...headers, 'sec-fetch-site': 'cross-site' }, '/api/session'), options).code, 403);
  assert.equal(checkRequest(request({ 'sec-fetch-site': 'same-origin', 'x-yuki-request': '1' }, '/api/session'), options).code, 403);
});
