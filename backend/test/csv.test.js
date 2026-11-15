import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvEscape, parseCsv } from '../src/util.js';

test('csvEscape: vazio, aspas e separadores', () => {
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(12), '12');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('a;b'), '"a;b"');
  assert.equal(csvEscape('diz "oi"'), '"diz ""oi"""');
  assert.equal(csvEscape('linha\nnova'), '"linha\nnova"');
});

test('csvEscape: bloqueia fórmula de planilha, mas não número negativo', () => {
  assert.equal(csvEscape('=SOMA(A1)'), "'=SOMA(A1)");
  assert.equal(csvEscape('@cmd'), "'@cmd");
  assert.equal(csvEscape('+cmd'), "'+cmd");
  assert.equal(csvEscape('-12'), '-12');
  assert.equal(csvEscape('-3.5'), '-3.5');
});

test('parseCsv: vírgula, aspas e linhas vazias', () => {
  assert.deepEqual(parseCsv('titulo,artista\n"Olá, mundo",Ana\n\n"diz ""oi""",Bia\n'), [
    ['titulo', 'artista'],
    ['Olá, mundo', 'Ana'],
    ['diz "oi"', 'Bia'],
  ]);
});

test('parseCsv: ponto e vírgula, CRLF e BOM do Excel', () => {
  assert.deepEqual(parseCsv('﻿titulo;ano\r\nSom;2020\r\n'), [['titulo', 'ano'], ['Som', '2020']]);
});

test('parseCsv: quebra de linha dentro de aspas e última linha sem \\n', () => {
  assert.deepEqual(parseCsv('a,b\n"x\ny",z'), [['a', 'b'], ['x\ny', 'z']]);
});

test('csvEscape e parseCsv: ida e volta', () => {
  const linhas = [['nome', 'obs'], ['Ana; Bia', 'disse "sim"'], ['x', 'a\nb']];
  const texto = linhas.map((l) => l.map(csvEscape).join(',')).join('\n');
  assert.deepEqual(parseCsv(texto), linhas);
});
