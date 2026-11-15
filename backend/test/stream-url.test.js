import './setup-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signStream, verifyStream } from '../src/security.js';

test('signStream/verifyStream: assinatura vale só para a mesma faixa e usuário', () => {
  const s = signStream('faixa-1', 'user-1');
  assert.equal(verifyStream('faixa-1', s), true);
  assert.equal(verifyStream('faixa-2', s), false);
  assert.equal(verifyStream('faixa-1', { ...s, u: 'user-2' }), false);
  assert.equal(verifyStream('faixa-1', { ...s, sig: s.sig.slice(0, -1) + (s.sig.endsWith('A') ? 'B' : 'A') }), false);
});

test('verifyStream: expirado ou incompleto é recusado', () => {
  const vencido = signStream('f', 'u', -10);
  assert.equal(verifyStream('f', vencido), false);
  const s = signStream('f', 'u');
  assert.equal(verifyStream('f', { ...s, exp: s.exp + 60 }), false);
  assert.equal(verifyStream('f', {}), false);
  assert.equal(verifyStream('f', { u: 'u', exp: s.exp }), false);
});
