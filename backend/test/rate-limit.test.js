import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, rateLimiter } from '../src/util.js';

function chamar(mw, ip) {
  const headers = {};
  let erro;
  mw({ ip }, { set: (k, v) => (headers[k] = v) }, (e) => (erro = e));
  return { headers, erro };
}

test('rateLimiter: conta por chave, manda cabeçalhos e devolve 429 no excesso', () => {
  const mw = rateLimiter({ windowMs: 60_000, max: 2, key: (req) => req.ip });
  const a = chamar(mw, '1.1.1.1');
  assert.equal(a.erro, undefined);
  assert.equal(a.headers['RateLimit-Limit'], '2');
  assert.equal(a.headers['RateLimit-Remaining'], '1');
  chamar(mw, '1.1.1.1');
  const c = chamar(mw, '1.1.1.1');
  assert.ok(c.erro instanceof HttpError);
  assert.equal(c.erro.status, 429);
  assert.equal(c.erro.code, 'RATE_LIMITED');
  assert.ok(Number(c.headers['Retry-After']) > 0);
  assert.equal(chamar(mw, '2.2.2.2').erro, undefined);
});

test('rateLimiter: sem chave não limita', () => {
  const mw = rateLimiter({ windowMs: 60_000, max: 1, key: () => null });
  for (let i = 0; i < 3; i++) assert.equal(chamar(mw, 'x').erro, undefined);
});

test('rateLimiter: janela vencida zera a contagem', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 0 });
  const mw = rateLimiter({ windowMs: 1000, max: 1, key: (req) => req.ip });
  chamar(mw, 'a');
  assert.ok(chamar(mw, 'a').erro);
  t.mock.timers.tick(1001);
  assert.equal(chamar(mw, 'a').erro, undefined);
});
