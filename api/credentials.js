const { createHash, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

function newOpaqueToken(prefix = '') {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

function makePasswordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (typeof password !== 'string' || !salt || !expectedHash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

module.exports = { createSessionToken, hashToken, makePasswordHash, newOpaqueToken, verifyPassword };
