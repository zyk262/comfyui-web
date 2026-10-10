import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordRecord, verifyPassword, LoginGuard, Sessions } from '../auth.mjs';

test('password hashing is salted and rejects wrong and malformed passwords', () => {
  const a = passwordRecord('example-test-password');
  const b = passwordRecord('example-test-password');
  assert.notEqual(a.hash, b.hash);
  assert.equal(verifyPassword('example-test-password', a), true);
  assert.equal(verifyPassword('incorrect', a), false);
  assert.equal(verifyPassword(null, a), false);
});
test('five failures block one IP, thirty failures block distributed guesses, and blocks expire', () => {
  let time = 0;
  const guard = new LoginGuard({ now: () => time });
  for (let n = 0; n < 5; n++) guard.fail('a');
  assert.equal(guard.check('a'), 900);
  assert.equal(guard.check('b'), 0);
  for (let n = 0; n < 25; n++) guard.fail('ip-' + n);
  assert.equal(guard.check('new-ip'), 900);
  time = 900001;
  assert.equal(guard.check('a'), 0);
});
test('successful login resets only its own failures, and session keys expire', () => {
  let time = 0;
  const guard = new LoginGuard({ now: () => time });
  guard.fail('a'); guard.fail('b'); guard.success('a');
  assert.deepEqual(guard.failures.map(f => f.ip), ['b']);
  const sessions = new Sessions({ now: () => time, ttl: 1000 });
  const key = sessions.issue().accessKey;
  assert.equal(sessions.valid(key), true);
  assert.equal(sessions.valid('incorrect'), false);
  time = 1000;
  assert.equal(sessions.valid(key), false);
});
