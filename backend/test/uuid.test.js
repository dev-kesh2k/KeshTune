import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, isUuid, uuidList, uuidParam, uuidv7 } from '../src/util.js';

test('uuidv7: formato, versão 7 e variante RFC', () => {
  const id = uuidv7();
  assert.ok(isUuid(id));
  assert.equal(id[14], '7');
  assert.match(id[19], /[89ab]/);
});

test('uuidv7: guarda o horário nos primeiros 48 bits (ordenável)', () => {
  const antes = Date.now();
  const id = uuidv7();
  const ms = parseInt(id.replace(/-/g, '').slice(0, 12), 16);
  assert.ok(ms >= antes && ms <= Date.now());
  const ids = Array.from({ length: 5 }, uuidv7);
  assert.equal(new Set(ids).size, 5);
});

test('uuidParam: valida e deixa minúsculo', () => {
  const id = uuidv7().toUpperCase();
  assert.equal(uuidParam(id), id.toLowerCase());
  assert.throws(() => uuidParam('123'), HttpError);
  assert.throws(() => uuidParam(undefined, 'trackId'), /trackId inválido/);
});

test('uuidList: lista não vazia e com limite', () => {
  const ids = [uuidv7(), uuidv7()];
  assert.deepEqual(uuidList(ids), ids);
  assert.throws(() => uuidList([]), /ao menos um/);
  assert.throws(() => uuidList('x'), /ao menos um/);
  assert.throws(() => uuidList(ids, 'ids', 1), /no máximo 1/);
  assert.throws(() => uuidList([ids[0], 'ruim']), /ids inválido/);
});
