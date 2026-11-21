import express from 'express';
import { one, q } from '../db.js';
import { auth } from '../security.js';
import { ah, int, notFound, oneOf, splitLines, uuidParam } from '../util.js';
import { albumCards, ARTIST_JSON, hydrateTracks, playlistCards } from '../views.js';
import { artistTop, topStale, trendingArtistsBR } from './youtube.js';

/** Cartões de artista na ordem dos ids. */
async function artistCards(idList) {
  const rows = await q(`SELECT id, name, image_url FROM artists WHERE id = ANY($1::uuid[])`, [idList]);
  const map = new Map(rows.map((r) => [r.id, r]));
  return idList.map((x) => map.get(x)).filter(Boolean);
}

export const catalogRouter = express.Router();
catalogRouter.use(['/browse', '/tracks', '/albums', '/artists', '/genres', '/radio', '/me/recommendations'], auth());

const ids = (rows) => rows.map((r) => r.id);

/** Mix por gosto: gêneros mais ouvidos (60 dias) → faixas populares desses gêneros ainda pouco ouvidas pelo usuário. */
async function mixFor(user, limit = 30) {
  if (!user.personalization) return [];
  const rows = await q(
    `WITH g AS (
       SELECT tg.genre_id, count(*) AS n FROM play_history h JOIN track_genres tg ON tg.track_id = h.track_id
        WHERE h.user_id = $1 AND h.played_at > now() - interval '60 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 5),
     a AS (
       SELECT ta.artist_id, count(*) AS n FROM play_history h JOIN track_artists ta ON ta.track_id = h.track_id AND ta.role = 'main'
        WHERE h.user_id = $1 AND h.played_at > now() - interval '60 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10),
     cand AS (
       SELECT tg.track_id AS id, g.n AS s FROM track_genres tg JOIN g ON g.genre_id = tg.genre_id
       UNION ALL SELECT ta.track_id, a.n FROM track_artists ta JOIN a ON a.artist_id = ta.artist_id)
     SELECT t.id, sum(c.s) AS score
       FROM cand c JOIN tracks t ON t.id = c.id
      WHERE t.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM play_history h WHERE h.user_id = $1 AND h.track_id = t.id AND h.played_at > now() - interval '2 days')
      GROUP BY t.id, t.popularity
      ORDER BY score DESC, t.popularity DESC, random() LIMIT $2`,
    [user.id, limit]
  );
  if (!rows.length || Number(rows[0].score) === 0) return [];
  return hydrateTracks(ids(rows), user);
}

// ----- Início -----
// A parte que é igual para todos (mais tocadas, novidades, lançamentos, playlists públicas) é montada uma vez a cada
// 3 min e reaproveitada; cada pedido só consulta o que é do usuário. Várias centrais abrindo o Início ao mesmo tempo
// esperam a mesma montagem.
const HOME_MS = 3 * 60 * 1000;
let home = { at: 0, data: null };
let homeBusy = null;

/** { topIds, newIds, catalogSize, releases, pubs } com cache de 3 min. */
function globalHome() {
  if (home.data && Date.now() - home.at < HOME_MS) return Promise.resolve(home.data);
  homeBusy ??= (async () => {
    const [topPlayed, newTracks, { n: catalogSize }, releases, pubs] = await Promise.all([
      q(
        `SELECT pc.track_id AS id FROM play_counts pc JOIN tracks t ON t.id = pc.track_id AND t.status = 'active'
          WHERE pc.day > current_date - 30 GROUP BY pc.track_id ORDER BY sum(pc.plays) DESC LIMIT 12`
      ),
      q(`SELECT id FROM tracks WHERE status = 'active' ORDER BY created_at DESC LIMIT 12`),
      one(`SELECT count(*)::int AS n FROM tracks WHERE status = 'active'`),
      albumCards('true', [], 12),
      // 24 para sobrar depois de tirar as do próprio usuário
      playlistCards(
        `p.visibility = 'public' AND NOT p.hidden_by_admin`, [],
        { limit: 24, order: `(SELECT count(*) FROM library_items li WHERE li.item_type = 'playlist' AND li.item_id = p.id) DESC, p.updated_at DESC` }
      ),
    ]);
    // Poucas reproduções no mês: completa com as mais populares
    const topRows = topPlayed.length >= 12 ? topPlayed : [
      ...topPlayed,
      ...(await q(
        `SELECT id FROM tracks WHERE status = 'active' AND NOT (id = ANY($1::uuid[])) ORDER BY popularity DESC, created_at DESC LIMIT $2`,
        [ids(topPlayed), 12 - topPlayed.length]
      )),
    ];
    const data = { topIds: ids(topRows), newIds: ids(newTracks), catalogSize, releases, pubs };
    home = { at: Date.now(), data };
    return data;
  })().finally(() => { homeBusy = null; });
  return homeBusy;
}

let popArtists = { at: 0, rows: null };

/** Artistas mais tocados do catálogo (só quando a parada de artistas em alta ainda não veio), com cache de 3 min. */
async function popularArtists() {
  if (popArtists.rows && Date.now() - popArtists.at < HOME_MS) return popArtists.rows;
  const rows = await q(
    `SELECT a.id, a.name, a.image_url FROM (
       SELECT ta.artist_id, sum(t.popularity) AS pop FROM track_artists ta JOIN tracks t ON t.id = ta.track_id AND t.status = 'active'
        GROUP BY ta.artist_id ORDER BY pop DESC LIMIT 12) x
       JOIN artists a ON a.id = x.artist_id ORDER BY x.pop DESC, a.name`
  );
  popArtists = { at: Date.now(), rows };
  return rows;
}

/** Até 12 faixas distintas mais recentes do histórico do usuário, olhando só as últimas `window` reproduções (null: todas). */
const recentIds = (userId, window) => q(
  `SELECT track_id AS id FROM (SELECT DISTINCT ON (track_id) track_id, played_at FROM (
     SELECT track_id, played_at FROM play_history WHERE user_id = $1 ORDER BY played_at DESC LIMIT $2) h
     ORDER BY track_id, played_at DESC) x ORDER BY played_at DESC LIMIT 12`,
  [userId, window]
);

catalogRouter.get('/browse/home', ah(async (req, res) => {
  const u = req.user;
  const gp = globalHome();
  const [g, recent, top, fresh, mix, followedReleases, myPlaylists, myArtists, trending] = await Promise.all([
    gp,
    // Tocadas recentemente: só as últimas 500 reproduções (não percorre o histórico inteiro do usuário). Quem repete
    // poucas faixas (repetir, rádio curto) pode não fechar 12 distintas nelas: aí olha o histórico inteiro
    recentIds(u.id, 500).then((rows) => (rows.length < 12 ? recentIds(u.id, null) : rows)).then((rows) => hydrateTracks(ids(rows), u)),
    gp.then((x) => hydrateTracks(x.topIds, u)),
    gp.then((x) => hydrateTracks(x.newIds, u)),
    mixFor(u, 20),
    albumCards(
      `EXISTS (SELECT 1 FROM album_artists aa JOIN library_items li ON li.item_type = 'artist' AND li.item_id = aa.artist_id AND li.user_id = $1
               WHERE aa.album_id = al.id) AND (al.release_date IS NULL OR al.release_date > current_date - 120)`,
      [u.id], 12
    ),
    playlistCards(
      `(p.owner_id = $1 OR EXISTS (SELECT 1 FROM library_items li WHERE li.user_id = $1 AND li.item_type = 'playlist' AND li.item_id = p.id))`,
      [u.id], { limit: 8 }
    ),
    q(
      `SELECT a.id, a.name, a.image_url FROM (
         SELECT ta.artist_id, count(*) AS n FROM play_history h
           JOIN track_artists ta ON ta.track_id = h.track_id AND ta.role IN ('main','featured')
          WHERE h.user_id = $1 AND h.played_at > now() - interval '90 days' GROUP BY ta.artist_id ORDER BY n DESC LIMIT 10) x
         JOIN artists a ON a.id = x.artist_id ORDER BY x.n DESC`,
      [u.id]
    ),
    // Artistas: os 10 em alta no Brasil (parada da Apple Music, atualizada em segundo plano)
    trendingArtistsBR(u.id).then(artistCards).catch((e) => {
      console.error('[home] artistas em alta:', e.message);
      return null;
    }),
  ]);
  const publicPlaylists = g.pubs.filter((p) => p.owner_id !== u.id).slice(0, 12);
  // Sem a parada (primeira vez ou fora do ar): os mais tocados do catálogo
  const artists = trending?.length ? trending : await popularArtists();
  res.json({
    catalog_size: g.catalogSize, recent, mix, top, fresh, releases: g.releases, followed_releases: followedReleases, my_playlists: myPlaylists,
    public_playlists: publicPlaylists, artists, my_artists: myArtists,
  });
}));

catalogRouter.get('/me/recommendations', ah(async (req, res) => {
  res.json({ items: await mixFor(req.user, 50) });
}));

catalogRouter.get('/browse/categories', ah(async (_req, res) => {
  const rows = await q(
    `SELECT g.id, g.name, g.kind, g.color,
            (SELECT count(*) FROM track_genres tg JOIN tracks t ON t.id = tg.track_id AND t.status = 'active' WHERE tg.genre_id = g.id)::int AS track_count,
            (SELECT COALESCE(t.cover_url, al.cover_url) FROM track_genres tg JOIN tracks t ON t.id = tg.track_id AND t.status = 'active'
               LEFT JOIN albums al ON al.id = t.album_id
              WHERE tg.genre_id = g.id AND COALESCE(t.cover_url, al.cover_url) IS NOT NULL
              ORDER BY t.popularity DESC, t.created_at LIMIT 1) AS cover_url
       FROM genres g ORDER BY g.kind, g.name`
  );
  res.json({ items: rows });
}));

catalogRouter.get('/genres/:id', ah(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1, required: true });
  const g = await one(`SELECT id, name, kind, color FROM genres WHERE id = $1`, [id]);
  if (!g) throw notFound('Gênero não encontrado');
  const rows = await q(
    `SELECT t.id FROM tracks t JOIN track_genres tg ON tg.track_id = t.id AND tg.genre_id = $1
      WHERE t.status = 'active' ORDER BY t.popularity DESC, t.created_at DESC LIMIT 100`,
    [id]
  );
  const albums = await albumCards(`EXISTS (SELECT 1 FROM tracks t JOIN track_genres tg ON tg.track_id = t.id WHERE t.album_id = al.id AND tg.genre_id = $1)`, [id], 20);
  res.json({ ...g, tracks: await hydrateTracks(ids(rows), req.user), albums });
}));

catalogRouter.get('/tracks/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const t = await one(
    `SELECT t.id, t.isrc, t.lyrics, t.created_at, t.disc_number, al.release_date, al.label,
            COALESCE((SELECT json_agg(json_build_object('id', a.id, 'name', a.name, 'role', ta.role) ORDER BY ta.role, ta.position)
               FROM track_artists ta JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id), '[]') AS credits,
            COALESCE((SELECT json_agg(json_build_object('id', g.id, 'name', g.name, 'kind', g.kind))
               FROM track_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.track_id = t.id), '[]') AS genres,
            (SELECT COALESCE(sum(plays), 0) FROM play_counts pc WHERE pc.track_id = t.id)::int AS plays
       FROM tracks t LEFT JOIN albums al ON al.id = t.album_id WHERE t.id = $1`,
    [id]
  );
  if (!t) throw notFound('Faixa não encontrada', 'TRACK_NOT_FOUND');
  const [base] = await hydrateTracks([id], req.user);
  res.json({ ...base, ...t, lyrics_synced: splitLines(t.lyrics || '').some((l) => /^\[\d{1,2}:\d{2}/.test(l.trimStart())) });
}));

catalogRouter.get('/albums/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const al = await one(
    `SELECT al.*, ${ARTIST_JSON} AS artists,
            EXISTS (SELECT 1 FROM library_items li WHERE li.user_id = $2 AND li.item_type = 'album' AND li.item_id = al.id) AS saved
       FROM albums al WHERE al.id = $1`,
    [id, req.user.id]
  );
  if (!al) throw notFound('Álbum não encontrado', 'ALBUM_NOT_FOUND');
  const rows = await q(
    `SELECT id FROM tracks WHERE album_id = $1 AND (status = 'active' OR $2) ORDER BY disc_number, track_number NULLS LAST, created_at`,
    [id, req.user.role === 'admin']
  );
  const tracks = await hydrateTracks(ids(rows), req.user);
  const more = al.artists[0]
    ? await albumCards(`al.id <> $1 AND EXISTS (SELECT 1 FROM album_artists aa WHERE aa.album_id = al.id AND aa.artist_id = $2)`, [id, al.artists[0].id], 10)
    : [];
  res.json({ ...al, tracks, duration_ms: tracks.reduce((s, t) => s + t.duration_ms, 0), more_by_artist: more });
}));

catalogRouter.get('/artists/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const a = await one(
    `SELECT a.*, EXISTS (SELECT 1 FROM library_items li WHERE li.user_id = $2 AND li.item_type = 'artist' AND li.item_id = a.id) AS followed,
            (SELECT count(*) FROM library_items li WHERE li.item_type = 'artist' AND li.item_id = a.id)::int AS followers,
            (SELECT count(DISTINCT h.user_id) FROM play_history h JOIN track_artists ta ON ta.track_id = h.track_id
              WHERE ta.artist_id = a.id AND h.played_at > now() - interval '30 days')::int AS monthly_listeners
       FROM artists a WHERE a.id = $1`,
    [id, req.user.id]
  );
  if (!a) throw notFound('Artista não encontrado', 'ARTIST_NOT_FOUND');
  // As 50 mais vistas no YouTube: na primeira vez espera a busca até 8 s (depois disso responde com o que há e
  // top_pending: true, e a busca continua); depois atualiza por semana em segundo plano
  let topPending = false;
  if (topStale(a)) {
    const fetching = artistTop(a, req.user.id).then(() => true, (e) => {
      console.error('[artist-top]', a.name, e.message);
      return true;
    });
    if (!a.top_fetched_at) {
      const done = await Promise.race([fetching, new Promise((r) => setTimeout(() => r(false), 8000).unref())]);
      topPending = !done;
    }
  }
  const ranked = await q(
    `SELECT att.track_id AS id FROM artist_top_tracks att JOIN tracks t ON t.id = att.track_id AND t.status = 'active'
      WHERE att.artist_id = $1 ORDER BY att.rank`,
    [id]
  );
  // Completa com as do catálogo (envios próprios, importações) até 50
  const top = ranked.length >= 50 ? ranked : ranked.concat(await q(
    `SELECT t.id FROM tracks t JOIN track_artists ta ON ta.track_id = t.id AND ta.artist_id = $1 AND ta.role IN ('main','featured')
      WHERE t.status = 'active' AND NOT (t.id = ANY($2::uuid[])) GROUP BY t.id ORDER BY max(t.popularity) DESC, max(t.created_at) DESC LIMIT $3`,
    [id, ids(ranked), 50 - ranked.length]
  ));
  const [topTracks, albums, appearsOn, playlists] = await Promise.all([
    hydrateTracks(ids(top), req.user),
    albumCards(`EXISTS (SELECT 1 FROM album_artists aa WHERE aa.album_id = al.id AND aa.artist_id = $1)`, [id], 50),
    albumCards(
      `NOT EXISTS (SELECT 1 FROM album_artists aa WHERE aa.album_id = al.id AND aa.artist_id = $1)
       AND EXISTS (SELECT 1 FROM tracks t JOIN track_artists ta ON ta.track_id = t.id WHERE t.album_id = al.id AND ta.artist_id = $1)`,
      [id], 20
    ),
    playlistCards(
      `p.visibility = 'public' AND NOT p.hidden_by_admin AND EXISTS (SELECT 1 FROM playlist_items pi JOIN track_artists ta ON ta.track_id = pi.track_id WHERE pi.playlist_id = p.id AND ta.artist_id = $1)`,
      [id], { limit: 10 }
    ),
  ]);
  res.json({ ...a, top_tracks: topTracks, albums, appears_on: appearsOn, playlists, top_pending: topPending });
}));

/** Rádio automático (regras da fase 1): mesmo artista, gêneros e humores da semente, por popularidade. */
export async function radioTracks(user, seedType, seedId, exclude = [], limit = 30) {
  let rows;
  if (seedType === 'artist') {
    rows = await q(
      // Candidatas: do artista ou dos gêneros dele (sem percorrer o catálogo inteiro)
      `WITH g AS (SELECT DISTINCT tg.genre_id FROM track_genres tg JOIN track_artists ta ON ta.track_id = tg.track_id WHERE ta.artist_id = $1),
            cand AS (SELECT ta.track_id AS id, 1 AS own FROM track_artists ta WHERE ta.artist_id = $1
                     UNION ALL SELECT tg.track_id, 0 FROM track_genres tg JOIN g ON g.genre_id = tg.genre_id)
       SELECT t.id FROM cand c JOIN tracks t ON t.id = c.id
        WHERE t.status = 'active' AND NOT (t.id = ANY($2::uuid[]))
        GROUP BY t.id, t.popularity
        ORDER BY max(c.own) DESC, random() * (t.popularity + 5) DESC
        LIMIT $3`,
      [seedId, exclude, limit]
    );
  } else if (seedType === 'genre') {
    rows = await q(
      `SELECT t.id FROM tracks t JOIN track_genres tg ON tg.track_id = t.id AND tg.genre_id = $1::int
        WHERE t.status = 'active' AND NOT (t.id = ANY($2::uuid[])) ORDER BY random() * (t.popularity + 5) DESC LIMIT $3`,
      [seedId, exclude, limit]
    );
  } else {
    rows = await q(
      `WITH s AS (SELECT ta.artist_id FROM track_artists ta WHERE ta.track_id = $1),
            g AS (SELECT tg.genre_id FROM track_genres tg WHERE tg.track_id = $1),
            al AS (SELECT album_id FROM tracks WHERE id = $1),
            -- candidatas: mesmo artista (+3), cada gênero em comum (+1), mesmo álbum (+1)
            cand AS (SELECT DISTINCT ta.track_id AS id, 3 AS s FROM track_artists ta JOIN s ON s.artist_id = ta.artist_id
                     UNION ALL SELECT tg.track_id, 1 FROM track_genres tg JOIN g ON g.genre_id = tg.genre_id
                     UNION ALL SELECT t.id, 1 FROM tracks t JOIN al ON al.album_id = t.album_id)
       SELECT t.id, sum(c.s) AS score
         FROM cand c JOIN tracks t ON t.id = c.id
        WHERE t.status = 'active' AND t.id <> $1 AND NOT (t.id = ANY($2::uuid[]))
        GROUP BY t.id, t.popularity
        ORDER BY score DESC, random() * (t.popularity + 5) DESC LIMIT $3`,
      [seedId, exclude, limit]
    );
  }
  let tracks = await hydrateTracks(ids(rows), user);
  if (tracks.length < limit) {
    const fill = await q(
      `SELECT id FROM tracks WHERE status = 'active' AND NOT (id = ANY($1::uuid[])) ORDER BY random() * (popularity + 5) DESC LIMIT $2`,
      [[...exclude, ...tracks.map((t) => t.id)], limit - tracks.length]
    );
    tracks = tracks.concat(await hydrateTracks(ids(fill), user));
  }
  return tracks.filter((t) => t.playable);
}

catalogRouter.get('/radio', ah(async (req, res) => {
  const type = oneOf(req.query.seed_type, 'seed_type', ['track', 'artist', 'genre'], 'track');
  const seed = type === 'genre' ? int(req.query.id, 'id', { required: true, min: 1 }) : uuidParam(req.query.id);
  const exclude = String(req.query.exclude || '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
  res.json({ items: await radioTracks(req.user, type, seed, exclude, Math.min(Number(req.query.limit) || 30, 50)) });
}));
