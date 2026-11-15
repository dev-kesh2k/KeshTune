import './setup-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, passwordProblem, tempPassword, verifyPassword } from '../src/security.js';

test('hashPassword/verifyPassword: scrypt com sal aleatório', async () => {
  const h = await hashPassword('senha123');
  assert.match(h, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(await hashPassword('senha123'), h);
  assert.equal(await verifyPassword('senha123', h), true);
  assert.equal(await verifyPassword('senha124', h), false);
});

test('verifyPassword: hash vazio ou em outro formato é falso', async () => {
  for (const s of [null, '', 'bcrypt$x', 'scrypt$1$2$3$4']) assert.equal(await verifyPassword('x', s), false, String(s));
});

test('passwordProblem: tamanho, letras e números', () => {
  assert.equal(passwordProblem('abc12345'), null);
  assert.match(passwordProblem('abc1'), /8 caracteres/);
  assert.match(passwordProblem(undefined), /8 caracteres/);
  assert.match(passwordProblem('a1'.repeat(65)), /longa/);
  assert.match(passwordProblem('abcdefgh'), /letras e números/);
  assert.match(passwordProblem('12345678'), /letras e números/);
});

test('tempPassword: passa na própria regra de senha e sem caracteres confusos', () => {
  for (let i = 0; i < 20; i++) {
    const s = tempPassword();
    assert.match(s, /^[A-HJ-NP-Za-km-z2-9]{10}#\d{2}$/);
    assert.equal(passwordProblem(s), null, s);
  }
});
