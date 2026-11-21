import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanChannelName, splitDashTitle, splitLines, splitPipes, stripOfficialSuffix, stripTitleTags, stripTopicSuffix, trimEndChar,
} from '../src/util.js';

test('nome do canal: tira " - Topic" e VEVO/Oficial/TV do fim', () => {
  assert.equal(stripTopicSuffix('Anitta - Topic'), 'Anitta');
  assert.equal(stripTopicSuffix('Anitta-topic'), 'Anitta');
  assert.equal(stripTopicSuffix('Topic'), 'Topic');
  assert.equal(stripTopicSuffix('Anitta Topic'), 'Anitta Topic');
  assert.equal(cleanChannelName('AnittaVEVO'), 'Anitta');
  assert.equal(cleanChannelName('Henrique e Juliano Oficial'), 'Henrique e Juliano');
  assert.equal(cleanChannelName('Canal TV'), 'Canal');
  assert.equal(cleanChannelName('Banda'), 'Banda');
});

test('título: tira etiquetas e o "- Official" do fim', () => {
  assert.equal(stripTitleTags('Música (Official Video) [4K]'), 'Música');
  assert.equal(stripTitleTags('Música (Lyrics) fim'), 'Música fim');
  assert.equal(stripTitleTags('Música (Ao Vivo)'), 'Música (Ao Vivo)');
  assert.equal(stripTitleTags('Música (hdtv)'), 'Música (hdtv)');
  assert.equal(stripTitleTags('Música (Vídeo'), 'Música (Vídeo');
  assert.equal(stripOfficialSuffix('Artista - Música - Official Video  '), 'Artista - Música');
  assert.equal(stripOfficialSuffix('Artista – Oficial'), 'Artista');
  assert.equal(stripOfficialSuffix('Artista -Official'), 'Artista');
  assert.equal(stripOfficialSuffix('Artista-Official'), 'Artista-Official');
});

test('título: divide em " | " e no traço', () => {
  assert.deepEqual(splitPipes('A - B | Ao Vivo | DVD'), ['A - B', 'Ao Vivo', 'DVD']);
  assert.deepEqual(splitPipes('A|B'), ['A|B']);
  assert.deepEqual(splitDashTitle('Artista - Música - Remix'), ['Artista - Música - Remix', 'Artista', 'Música - Remix']);
  assert.deepEqual(splitDashTitle('Artista — Música'), ['Artista — Música', 'Artista', 'Música']);
  assert.equal(splitDashTitle('Artista-Música'), null);
  assert.equal(splitDashTitle('- Música'), null);
});

test('linhas e caracteres finais', () => {
  assert.deepEqual(splitLines('a\r\nb\nc'), ['a', '', 'b', 'c']);
  assert.equal(trimEndChar('/keshtune///', '/'), '/keshtune');
  assert.equal(trimEndChar('ABC==', '='), 'ABC');
});
