import { test } from 'node:test';
import assert from 'node:assert/strict';
import { albumType, fmtBytes, fmtTime, fmtTotal } from '../src/lib/fmt.ts';

test('fmtTime: m:ss e h:mm:ss, valor inválido vira 0:00', () => {
  assert.equal(fmtTime(0), '0:00');
  assert.equal(fmtTime(65_000), '1:05');
  assert.equal(fmtTime(3_725_000), '1:02:05');
  assert.equal(fmtTime(-1), '0:00');
  assert.equal(fmtTime(Number.NaN), '0:00');
});

test('fmtTotal: minutos e horas', () => {
  assert.equal(fmtTotal(0), '0 min');
  assert.equal(fmtTotal(45 * 60_000), '45 min');
  assert.equal(fmtTotal(60 * 60_000), '1 h');
  assert.equal(fmtTotal(95 * 60_000), '1 h 35 min');
});

test('fmtBytes: B, KB, MB e GB', () => {
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtBytes(2048), '2 KB');
  assert.equal(fmtBytes(5.5 * 1024 ** 2), '5,5 MB');
  assert.equal(fmtBytes(3 * 1024 ** 3), '3,00 GB');
  assert.equal(fmtBytes(-5), '0 B');
});

test('albumType: tradução e padrão', () => {
  assert.equal(albumType('single'), 'Single');
  assert.equal(albumType('compilation'), 'Coletânea');
  assert.equal(albumType('outro'), 'Álbum');
});
