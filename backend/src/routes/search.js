import express from 'express';
import { q } from '../db.js';
import { auth } from '../security.js';
import { ah, bad, isUuid, oneOf, str } from '../util.js';
import { ARTIST_JSON, hydrateTracks, playlistCards } from '../views.js';
import { normalizeSearch } from '../media-links.js';

export const searchRouter = express.Router();
searchRouter.use('/search', auth());

const TYPES = ['track', 'artist', 'album', 'playlist', 'user'];
const esc = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

// score: prefixo > contém > similaridade (tolerância a erros de digitação, pg_trgm)
const scoreSql = (col) => `(CASE WHEN f_norm(${col}) LIKE $2 THEN 2 WHEN f_norm(${col}) LIKE $3 THEN 1 ELSE 0 END
  + GREATEST(similarity(f_norm(${col}), $1), word_similarity($1, f_norm(${col}))))`;
// Operadores (<% = word_similarity, % = similarity) em vez das funções: assim o índice GIN de trigramas é usado.
// Os limites (0,45 e 0,3) são definidos em cada conexão (db.js).
const matchSql = (col) => `(f_norm(${col}) LIKE $3 OR $1 <% f_norm(${col}) OR f_norm(${col}) % $1)`;

async function runSearch(user, raw, types, limit) {
  const nq = normalizeSearch(raw);
  const p = [nq, `${esc(nq)}%`, `%${esc(nq)}%`];
  // Cada tipo é uma consulta independente: rodam em paralelo (só os pedidos), e a resposta sai
  // no tempo da mais lenta em vez da soma de todas.
  const tasks = {
    // Candidatos pelo índice (título ou artista); a nota só é calculada para eles
    tracks: () => q(
      `WITH ma AS (SELECT a.id FROM artists a WHERE ${matchSql('a.name')}),
            cand AS (SELECT t.id FROM tracks t WHERE ${matchSql('t.title')}
                     UNION SELECT ta.track_id FROM track_artists ta JOIN ma ON ma.id = ta.artist_id)
       SELECT t.id, GREATEST(${scoreSql('t.title')},
              COALESCE((SELECT max(${scoreSql('a.name')}) * 0.8 FROM track_artists ta JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id), 0)) AS score
         FROM cand JOIN tracks t ON t.id = cand.id
        WHERE t.status = 'active'
        ORDER BY score DESC, t.popularity DESC LIMIT ${limit}`,
      p
    ).then((rows) => hydrateTracks(rows.map((r) => r.id), user)),
    artists: () => q(
      `SELECT a.id, a.name, a.image_url, a.verified FROM artists a WHERE ${matchSql('a.name')}
        ORDER BY ${scoreSql('a.name')} DESC, a.name LIMIT ${limit}`,
      p
    ),
    albums: () => q(
      `SELECT al.id, al.title, al.type, al.release_date, al.cover_url, ${ARTIST_JSON} AS artists FROM albums al
        WHERE ${matchSql('al.title')} AND EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = al.id AND t.status = 'active')
        ORDER BY ${scoreSql('al.title')} DESC LIMIT ${limit}`,
      p
    ),
    playlists: () => playlistCards(
      `p.visibility = 'public' AND NOT p.hidden_by_admin AND ${matchSql('p.name')}`, p,
      { limit, order: `${scoreSql('p.name')} DESC` }
    ),
    users: () => q(
      `SELECT id, display_name, avatar_url FROM users WHERE deleted_at IS NULL AND status = 'active' AND ${matchSql('display_name')}
        ORDER BY ${scoreSql('display_name')} DESC LIMIT ${limit}`,
      p
    ),
  };
  // Mesma ordem de chaves de antes (track, artist, album, playlist, user)
  const keys = TYPES.filter((t) => types.includes(t)).map((t) => `${t}s`);
  const values = await Promise.all(keys.map((k) => tasks[k]()));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}

searchRouter.get('/search', ah(async (req, res) => {
  const raw = str(req.query.q, 'Busca', { required: true, max: 200 });
  const types = String(req.query.type || TYPES.join(',')).split(',').filter((t) => TYPES.includes(t));
  if (!types.length) throw bad('type inválido');
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const result = await runSearch(req.user, raw, types, limit);
  const total = Object.values(result).reduce((s, v) => s + v.length, 0);
  // "Você quis dizer...": termo mais parecido do catálogo quando há poucos resultados
  let did_you_mean = null;
  // O app manda dym=0 (não mostra a sugestão) e economiza essa consulta; o site não manda e continua igual.
  if (total < 3 && raw.length >= 3 && req.query.dym !== '0') {
    // Só sugere quando o termo não aparece em nada do catálogo (o filtro escolhido pode só não ter resultado).
    // Candidatos pelo operador % (índice de trigramas) em vez de calcular a similaridade com tudo.
    const nq = normalizeSearch(raw);
    const best = await q(
      `SELECT name FROM (
         (SELECT title AS name, similarity(f_norm(title), $1) AS sim FROM tracks WHERE status = 'active' AND f_norm(title) % $1 ORDER BY sim DESC LIMIT 1)
         UNION ALL (SELECT name, similarity(f_norm(name), $1) FROM artists WHERE f_norm(name) % $1 ORDER BY 2 DESC LIMIT 1)
         UNION ALL (SELECT title, similarity(f_norm(title), $1) FROM albums WHERE f_norm(title) % $1 ORDER BY 2 DESC LIMIT 1)) x
        WHERE f_norm(name) <> $1
          AND NOT EXISTS (SELECT 1 FROM tracks WHERE status = 'active' AND f_norm(title) LIKE $2)
          AND NOT EXISTS (SELECT 1 FROM artists WHERE f_norm(name) LIKE $2)
        ORDER BY sim DESC LIMIT 1`,
      [nq, `%${esc(nq)}%`]
    );
    did_you_mean = best[0]?.name || null;
  }
  res.json({ q: raw, ...result, did_you_mean });
}));

searchRouter.get('/search/suggest', ah(async (req, res) => {
  const raw = String(req.query.q || '').trim().slice(0, 100);
  if (!raw) return res.json({ items: [] });
  const r = await runSearch(req.user, raw, ['track', 'artist', 'album', 'playlist'], 4);
  const items = [
    ...r.artists.map((a) => ({ type: 'artist', id: a.id, title: a.name, image_url: a.image_url })),
    ...r.tracks.map((t) => ({ type: 'track', id: t.id, title: t.title, subtitle: t.artists.map((a) => a.name).join(', '), image_url: t.cover_url })),
    ...r.albums.map((a) => ({ type: 'album', id: a.id, title: a.title, subtitle: a.artists.map((x) => x.name).join(', '), image_url: a.cover_url })),
    ...r.playlists.map((p) => ({ type: 'playlist', id: p.id, title: p.name, subtitle: p.owner_name, image_url: p.cover_url || p.mosaic?.[0] })),
  ].slice(0, 8);
  res.json({ items });
}));

searchRouter.get('/search/history', ah(async (req, res) => {
  const rows = await q(
    `SELECT DISTINCT ON (COALESCE(item_id::text, lower(query))) id, query, item_type, item_id, created_at
       FROM search_history WHERE user_id = $1 ORDER BY COALESCE(item_id::text, lower(query)), created_at DESC`,
    [req.user.id]
  );
  rows.sort((a, b) => b.created_at - a.created_at);
  const top = rows.slice(0, 15);
  // nomes atuais dos itens clicados
  const enrich = async (type, sql) => {
    const idsOf = top.filter((r) => r.item_type === type).map((r) => r.item_id);
    if (!idsOf.length) return new Map();
    return new Map((await q(sql, [idsOf])).map((x) => [x.id, x]));
  };
  const tr = await enrich('track', `SELECT t.id, t.title, COALESCE(t.cover_url, al.cover_url) AS image_url FROM tracks t LEFT JOIN albums al ON al.id = t.album_id WHERE t.id = ANY($1::uuid[])`);
  const ar = await enrich('artist', `SELECT id, name AS title, image_url FROM artists WHERE id = ANY($1::uuid[])`);
  const al = await enrich('album', `SELECT id, title, cover_url AS image_url FROM albums WHERE id = ANY($1::uuid[])`);
  const pl = await enrich('playlist', `SELECT id, name AS title, cover_url AS image_url FROM playlists WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`);
  const us = await enrich('user', `SELECT id, display_name AS title, avatar_url AS image_url FROM users WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`);
  const maps = { track: tr, artist: ar, album: al, playlist: pl, user: us };
  const items = top
    .map((r) => {
      if (!r.item_id) return { id: r.id, type: 'query', query: r.query };
      const x = maps[r.item_type]?.get(r.item_id);
      return x ? { id: r.id, type: r.item_type, item_id: r.item_id, title: x.title, image_url: x.image_url } : null;
    })
    .filter(Boolean);
  res.json({ items });
}));

searchRouter.post('/search/history', ah(async (req, res) => {
  const query = str(req.body?.query, 'Busca', { max: 200 });
  const itemType = req.body?.item_type ? oneOf(req.body.item_type, 'item_type', TYPES) : null;
  const itemId = req.body?.item_id && isUuid(req.body.item_id) ? req.body.item_id : null;
  if (!query && !itemId) throw bad('Nada para salvar');
  if (!req.user.personalization && !itemId) return res.json({ ok: true });
  await q(`INSERT INTO search_history (user_id, query, item_type, item_id) VALUES ($1,$2,$3,$4)`, [req.user.id, query, itemType, itemId]);
  await q(
    `DELETE FROM search_history WHERE user_id = $1 AND id NOT IN (SELECT id FROM search_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200)`,
    [req.user.id]
  );
  res.status(201).json({ ok: true });
}));

searchRouter.delete('/search/history', ah(async (req, res) => {
  const id = req.query.id ? Number(req.query.id) : null;
  if (id) {
    const row = await q(`SELECT query, item_id FROM search_history WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
    if (row[0]) {
      await q(
        `DELETE FROM search_history WHERE user_id = $1 AND (($2::uuid IS NOT NULL AND item_id = $2) OR ($2::uuid IS NULL AND item_id IS NULL AND lower(query) = lower($3)))`,
        [req.user.id, row[0].item_id, row[0].query]
      );
    }
  } else await q(`DELETE FROM search_history WHERE user_id = $1`, [req.user.id]);
  res.json({ ok: true });
}));
