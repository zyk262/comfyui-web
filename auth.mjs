import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function passwordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  return { version: 1, salt, hash: scryptSync(password, salt, 32).toString('hex') };
}
export function verifyPassword(password, record) {
  if (typeof password !== 'string' || password.length > 256 || !record?.salt || !record?.hash) return false;
  const expected = Buffer.from(record.hash, 'hex');
  const actual = scryptSync(password, record.salt, 32);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export class LoginGuard {
  constructor({ now = Date.now, windowMs = 15 * 60 * 1000, perIp = 5, global = 30 } = {}) {
    this.now = now; this.windowMs = windowMs; this.perIp = perIp; this.global = global;
    this.failures = [];
  }
  check(ip) {
    const now = this.now();
    this.failures = this.failures.filter(f => f.at > now - this.windowMs);
    const own = this.failures.filter(f => f.ip === ip);
    const blocked = this.failures.length >= this.global ? this.failures : own.length >= this.perIp ? own : null;
    return blocked ? Math.max(1, Math.ceil((blocked[0].at + this.windowMs - now) / 1000)) : 0;
  }
  fail(ip) { this.failures.push({ ip, at: this.now() }); }
  success(ip) { this.failures = this.failures.filter(f => f.ip !== ip); }
}

export class Sessions {
  constructor({ now = Date.now, ttl = 8 * 60 * 60 * 1000 } = {}) { this.now = now; this.ttl = ttl; this.entries = new Map(); }
  prune() { for (const [key, expires] of this.entries) if (expires <= this.now()) this.entries.delete(key); }
  issue() {
    this.prune();
    if (this.entries.size >= 50) this.entries.delete(this.entries.keys().next().value);
    const accessKey = randomBytes(32).toString('hex');
    const expiresAt = this.now() + this.ttl;
    this.entries.set(accessKey, expiresAt);
    return { accessKey, expiresAt };
  }
  valid(key) { this.prune(); return this.entries.has(key); }
}
