import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripBrackets, stripVideoTags } from '../src/lib/text.ts';

test('stripBrackets: tira as marcas de tempo da letra', () => {
  assert.equal(stripBrackets('[00:12.50]Primeira linha'), 'Primeira linha');
  assert.equal(stripBrackets('[00:01][00:30] Refrão [x'), ' Refrão [x');
  assert.equal(stripBrackets('sem marcas'), 'sem marcas');
});

test('stripVideoTags: tira "(Official Video)" e afins do título', () => {
  assert.equal(stripVideoTags('Música (Official Video) [Áudio]'), 'Música');
  assert.equal(stripVideoTags('Música (Lyric Video) - Ao Vivo'), 'Música - Ao Vivo');
  assert.equal(stripVideoTags('Música (Ao Vivo)'), 'Música (Ao Vivo)');
  assert.equal(stripVideoTags('Música (Vídeo'), 'Música (Vídeo');
});
