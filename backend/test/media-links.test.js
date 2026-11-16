import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, interleave, isoDuration, normalizeSearch, spotifyUrl, youtubeId } from '../src/media-links.js';

test('decodeEntities: entidades dos títulos do YouTube', () => {
  assert.equal(decodeEntities('Rock &amp; Roll &quot;ao vivo&quot; &#39;22 &lt;3&gt;'), 'Rock & Roll "ao vivo" \'22 <3>');
  assert.equal(decodeEntities(null), '');
  assert.equal(decodeEntities('&nbsp;'), '&nbsp;');
});

test('isoDuration: PT em milissegundos', () => {
  assert.equal(isoDuration('PT3M45S'), 225_000);
  assert.equal(isoDuration('PT1H2M3S'), 3_723_000);
  assert.equal(isoDuration('PT45S'), 45_000);
  assert.equal(isoDuration('P1D'), 0);
  assert.equal(isoDuration(undefined), 0);
});

test('youtubeId: id puro e todos os formatos de link', () => {
  const id = 'dQw4w9WgXcQ';
  for (const u of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?list=PL1&v=${id}&t=10`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://music.youtube.com/watch?v=${id}`,
  ]) assert.equal(youtubeId(u), id, u);
  for (const u of ['', 'curto', 'https://vimeo.com/123', `https://youtube.com/watch?v=${id.slice(0, 10)}`]) assert.equal(youtubeId(u), null, u);
});

test('spotifyUrl: links e URIs viram o link canônico', () => {
  const id = '4uLU6hMCjMI75M1A2tKUQC';
  assert.equal(spotifyUrl(`https://open.spotify.com/track/${id}?si=x`), `https://open.spotify.com/track/${id}`);
  assert.equal(spotifyUrl(`https://open.spotify.com/intl-pt/album/${id}`), `https://open.spotify.com/album/${id}`);
  assert.equal(spotifyUrl(`spotify:playlist:${id}`), `https://open.spotify.com/playlist/${id}`);
  assert.equal(spotifyUrl(`https://open.spotify.com/show/${id}`), null);
  assert.equal(spotifyUrl('https://evil.com/open.spotify.com/track/x'), null);
});

test('normalizeSearch: sem acento, minúsculo e sem espaço nas pontas', () => {
  assert.equal(normalizeSearch('  Canção ÁGUA  '), 'cancao agua');
  assert.equal(normalizeSearch(undefined), '');
});

test('interleave: alterna as listas, sem repetir e sem ao vivo, até o máximo', () => {
  const v = (id, live = false) => ({ youtube_id: id, live });
  const out = interleave([[v('a1'), v('a2'), v('x')], [v('b1'), v('x'), v('b3', true)], [v('c1')]]);
  assert.deepEqual(out.map((x) => x.youtube_id), ['a1', 'b1', 'c1', 'a2', 'x']);
  assert.equal(interleave([[v('1'), v('2'), v('3')]], 2).length, 2);
  assert.deepEqual(interleave([]), []);
});
