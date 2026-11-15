import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, dateStr, int, isEmail, oneOf, str } from '../src/util.js';

const bad = (re) => (e) => e instanceof HttpError && e.status === 400 && e.code === 'INVALID_INPUT' && re.test(e.message);

test('str: opcional vira null, corta espaços e checa tamanho', () => {
  assert.equal(str(undefined, 'Nome'), null);
  assert.equal(str('  ', 'Nome'), null);
  assert.equal(str('  Ana ', 'Nome'), 'Ana');
  assert.equal(str(' Ana ', 'Nome', { trim: false }), ' Ana ');
  assert.equal(str(42, 'Nome'), '42');
  assert.throws(() => str('', 'Nome', { required: true }), bad(/obrigatório/));
  assert.throws(() => str('   ', 'Nome', { required: true }), bad(/obrigatório/));
  assert.throws(() => str('ab', 'Nome', { min: 3 }), bad(/ao menos 3/));
  assert.throws(() => str('abcd', 'Nome', { max: 3 }), bad(/no máximo 3/));
  assert.throws(() => str({}, 'Nome'), bad(/inválido/));
});

test('int: inteiro dentro da faixa', () => {
  assert.equal(int('7', 'Ano'), 7);
  assert.equal(int(null, 'Ano'), null);
  assert.throws(() => int('', 'Ano', { required: true }), bad(/obrigatório/));
  assert.throws(() => int('1.5', 'Ano'), bad(/inválido/));
  assert.throws(() => int(10, 'Ano', { max: 9 }), bad(/inválido/));
});

test('oneOf: valor padrão quando vazio', () => {
  assert.equal(oneOf(undefined, 'Ordem', ['a', 'b'], 'a'), 'a');
  assert.equal(oneOf('b', 'Ordem', ['a', 'b'], 'a'), 'b');
  assert.throws(() => oneOf('c', 'Ordem', ['a', 'b']), bad(/inválido/));
});

test('dateStr: recusa datas que não existem', () => {
  assert.equal(dateStr('2024-02-29', 'Data'), '2024-02-29');
  assert.equal(dateStr('', 'Data'), null);
  for (const v of ['2026-02-31', '2025-02-29', '2026-13-01', '15/11/2026', 20261115]) {
    assert.throws(() => dateStr(v, 'Data'), bad(/inválida/), String(v));
  }
});

test('isEmail', () => {
  assert.equal(isEmail('ana@exemplo.com'), true);
  assert.equal(isEmail('ana@exemplo.c'), false);
  assert.equal(isEmail('ana exemplo.com'), false);
  assert.equal(isEmail(`${'a'.repeat(250)}@x.com`), false);
  assert.equal(isEmail(null), false);
});
