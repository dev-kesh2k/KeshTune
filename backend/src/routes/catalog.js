import express from 'express';
import { one, q } from '../db.js';
import { auth } from '../security.js';
import { ah, int, notFound, oneOf, uuidParam } from '../util.js';
import { albumCards, ARTIST_JSON, hydrateTracks, playlistCards } from '../views.js';

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
        WHERE h.user_id = $1 AND h.played_at > now() - interval '60 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10)
     SELECT t.id, (COALESCE((SELECT sum(g.n) FROM track_genres tg JOIN g ON g.genre_id = tg.genre_id WHERE tg.track_id = t.id), 0)
                 + COALESCE((SELECT sum(a.n) FROM track_artists ta JOIN a ON a.artist_id = ta.artist_id WHERE ta.track_id = t.id), 0)) AS score
       FROM tracks t
      WHERE t.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM play_history h WHERE h.user_id = $1 AND h.track_id = t.id AND h.played_at > now() - interval '2 days')
      ORDER BY score DESC, t.popularity DESC, random() LIMIT $2`,
    [user.id, limit]
  );
  if (!rows.length || Number(rows[0].score) === 0) return [];
  return hydrateTracks(ids(rows), user);
}

catalogRouter.get('/browse/home', ah(async (req, res) => {
  const u = req.user;
  const recentRows = await q(
    `SELECT track_id AS id FROM (SELECT DISTINCT ON (track_id) track_id, played_at FROM play_history WHERE user_id = $1
       ORDER BY track_id, played_at DESC) x ORDER BY played_at DESC LIMIT 12`,
    [u.id]
  );
  const topRows = await q(
    `SELECT t.id FROM tracks t LEFT JOIN play_counts pc ON pc.track_id = t.id AND pc.day > current_date - 30
      WHERE t.status = 'active' GROUP BY t.id ORDER BY COALESCE(sum(pc.plays), 0) DESC, t.popularity DESC, t.created_at DESC LIMIT 12`
  );
  const newTracks = await q(`SELECT id FROM tracks WHERE status = 'active' ORDER BY created_at DESC LIMIT 12`);
  const [recent, top, fresh, mix] = await Promise.all([
    hydrateTracks(ids(recentRows), u), hydrateTracks(ids(topRows), u), hydrateTracks(ids(newTracks), u), mixFor(u, 20),
  ]);
  const releases = await albumCards('true', [], 12);
  const followedReleases = await albumCards(
    `EXISTS (SELECT 1 FROM album_artists aa JOIN library_items li ON li.item_type = 'artist' AND li.item_id = aa.artist_id AND li.user_id = $1
             WHERE aa.album_id = al.id) AND (al.release_date IS NULL OR al.release_date > current_date - 120)`,
    [u.id], 12
  );
  const myPlaylists = await playlistCards(
    `(p.owner_id = $1 OR EXISTS (SELECT 1 FROM library_items li WHERE li.user_id = $1 AND li.item_type = 'playlist' AND li.item_id = p.id))`,
    [u.id], { limit: 8 }
  );
  const publicPlaylists = await playlistCards(
    `p.visibility = 'public' AND NOT p.hidden_by_admin AND p.owner_id <> $1`, [u.id],
    { limit: 12, order: `(SELECT count(*) FROM library_items li WHERE li.item_type = 'playlist' AND li.item_id = p.id) DESC, p.updated_at DESC` }
  );
  const artists = await q(
    `SELECT a.id, a.name, a.image_url FROM artists a
      WHERE EXISTS (SELECT 1 FROM track_artists ta JOIN tracks t ON t.id = ta.track_id AND t.status = 'active' WHERE ta.artist_id = a.id)
      ORDER BY (SELECT COALESCE(sum(t.popularity), 0) FROM track_artists ta JOIN tracks t ON t.id = ta.track_id WHERE ta.artist_id = a.id) DESC, a.name
      LIMIT 12`
  );
  const { n: catalogSize } = await one(`SELECT count(*)::int AS n FROM tracks WHERE status = 'active'`);
  res.json({ catalog_size: catalogSize, recent, mix, top, fresh, releases, followed_releases: followedReleases, my_playlists: myPlaylists, public_playlists: publicPlaylists, artists });
}));

catalogRouter.get('/me/recommendations', ah(async (req, res) => {
  res.json({ items: await mixFor(req.user, 50) });
}));

catalogRouter.get('/browse/categories', ah(async (_req, res) => {
  const rows = await q(
    `SELECT g.id, g.name, g.kind, g.color,
            (SELECT t.cover_url FROM track_genres tg JOIN tracks t ON t.id = tg.track_id AND t.status = 'active' WHERE tg.genre_id = g.id AND t.cover_url IS NOT NULL ORDER BY t.popularity DESC, t.created_at DESC LIMIT 1) AS cover_url,
            (SELECT count(*) FROM track_genres tg JOIN tracks t ON t.id = tg.track_id AND t.status = 'active' WHERE tg.genre_id = g.id)::int AS track_count
       FROM genres g ORDER BY g.kind, g.name`
  );
  res.json({ items: rows });
}));

catalogRouter.get('/genres/:id', ah(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1, required: true });
  const g = await one(`SELECT g.id, g.name, g.kind, g.color, (SELECT t.cover_url FROM track_genres tg JOIN tracks t ON t.id = tg.track_id AND t.status = 'active' WHERE tg.genre_id = g.id AND t.cover_url IS NOT NULL ORDER BY t.popularity DESC, t.created_at DESC LIMIT 1) AS cover_url FROM genres g WHERE g.id = $1`, [id]);
  if (!g) throw notFound('Gênero não encontrado');
  const rows = await q(
    `SELECT t.id FROM tracks t JOIN track_genres tg ON tg.track_id = t.id AND tg.genre_id = $1
      WHERE t.status = 'active' ORDER BY t.popularity DESC, t.created_at DESC LIMIT 500`,
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
  res.json({ ...base, ...t, lyrics_synced: /^\s*\[\d{1,2}:\d{2}/m.test(t.lyrics || '') });
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
  const top = await q(
    `SELECT t.id FROM tracks t JOIN track_artists ta ON ta.track_id = t.id AND ta.artist_id = $1 AND ta.role IN ('main','featured')
      WHERE t.status = 'active' GROUP BY t.id ORDER BY max(t.popularity) DESC, max(t.created_at) DESC LIMIT 10`,
    [id]
  );
  const albums = await albumCards(`EXISTS (SELECT 1 FROM album_artists aa WHERE aa.album_id = al.id AND aa.artist_id = $1)`, [id], 50);
  const appearsOn = await albumCards(
    `NOT EXISTS (SELECT 1 FROM album_artists aa WHERE aa.album_id = al.id AND aa.artist_id = $1)
     AND EXISTS (SELECT 1 FROM tracks t JOIN track_artists ta ON ta.track_id = t.id WHERE t.album_id = al.id AND ta.artist_id = $1)`,
    [id], 20
  );
  const playlists = await playlistCards(
    `p.visibility = 'public' AND NOT p.hidden_by_admin AND EXISTS (SELECT 1 FROM playlist_items pi JOIN track_artists ta ON ta.track_id = pi.track_id WHERE pi.playlist_id = p.id AND ta.artist_id = $1)`,
    [id], { limit: 10 }
  );
  res.json({ ...a, top_tracks: await hydrateTracks(ids(top), req.user), albums, appears_on: appearsOn, playlists });
}));

/** Rádio automático (regras da fase 1): mesmo artista, gêneros e humores da semente, por popularidade. */
export async function radioTracks(user, seedType, seedId, exclude = [], limit = 30) {
  let rows;
  if (seedType === 'artist') {
    rows = await q(
      `WITH g AS (SELECT DISTINCT tg.genre_id FROM track_genres tg JOIN track_artists ta ON ta.track_id = tg.track_id WHERE ta.artist_id = $1)
       SELECT t.id FROM tracks t WHERE t.status = 'active' AND NOT (t.id = ANY($2::uuid[]))
          AND (EXISTS (SELECT 1 FROM track_artists ta WHERE ta.track_id = t.id AND ta.artist_id = $1)
               OR EXISTS (SELECT 1 FROM track_genres tg JOIN g ON g.genre_id = tg.genre_id WHERE tg.track_id = t.id))
        ORDER BY (EXISTS (SELECT 1 FROM track_artists ta WHERE ta.track_id = t.id AND ta.artist_id = $1)) DESC, random() * (t.popularity + 5) DESC
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
            al AS (SELECT album_id FROM tracks WHERE id = $1)
       SELECT t.id,
              (CASE WHEN EXISTS (SELECT 1 FROM track_artists ta JOIN s ON s.artist_id = ta.artist_id WHERE ta.track_id = t.id) THEN 3 ELSE 0 END
             + (SELECT count(*) FROM track_genres tg JOIN g ON g.genre_id = tg.genre_id WHERE tg.track_id = t.id)
             + CASE WHEN t.album_id = (SELECT album_id FROM al) THEN 1 ELSE 0 END) AS score
         FROM tracks t WHERE t.status = 'active' AND t.id <> $1 AND NOT (t.id = ANY($2::uuid[]))
        ORDER BY score DESC, random() * (t.popularity + 5) DESC LIMIT $3`,
      [seedId, exclude, limit]
    );
  }
  let tracks = await hydrateTracks(ids(rows), user);
  if (tracks.length < Math.min(limit, 10)) {
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
