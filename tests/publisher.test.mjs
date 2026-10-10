import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionRecord } from '../publisher.mjs';
test('the public discovery record contains only a valid tunnel URL and expiration', () => {
  const record = connectionRecord('https://winter-day.trycloudflare.com', 1000000);
  assert.deepEqual(Object.keys(record), ['version', 'online', 'bridgeUrl', 'updatedAt', 'expiresAt']);
  assert.equal(Date.parse(record.expiresAt) - Date.parse(record.updatedAt), 86400000);
  assert.throws(() => connectionRecord('https://example.com'));
  assert.throws(() => connectionRecord('http://winter-day.trycloudflare.com'));
});
