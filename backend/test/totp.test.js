import './setup-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTotpSecret, verifyTotp } from '../src/security.js';

// Segredo do apêndice B da RFC 6238 ("12345678901234567890" em base32).
const RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('verifyTotp: vetores da RFC 6238 (6 dígitos)', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 59_000 });
  assert.equal(verifyTotp(RFC, '287082'), true);
  t.mock.timers.setTime(1_111_111_109_000);
  assert.equal(verifyTotp(RFC, '081804'), true);
  assert.equal(verifyTotp(RFC, '081 804'), true);
});

test('verifyTotp: aceita um passo de diferença e recusa código errado', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 59_000 + 30_000 });
  assert.equal(verifyTotp(RFC, '287082'), true);
  t.mock.timers.setTime(59_000 + 90_000);
  assert.equal(verifyTotp(RFC, '287082'), false);
  for (const c of ['', '12345', '1234567', 'abcdef', null]) assert.equal(verifyTotp(RFC, c), false, String(c));
});

test('newTotpSecret: 32 caracteres base32', () => {
  const s = newTotpSecret();
  assert.match(s, /^[A-Z2-7]{32}$/);
  assert.notEqual(newTotpSecret(), s);
});
