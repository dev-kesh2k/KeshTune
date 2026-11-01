import { q } from './db.js';

/** Carrega faixas completas (artistas, álbum, curtida) preservando a ordem dos ids. */
export async function hydrateTracks(ids, user) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return [];
  const rows = await q(
    `SELECT t.id, t.title, t.duration_ms, t.explicit, t.source, t.youtube_id, t.status, t.popularity,
            t.track_number, t.disc_number, (t.lyrics IS NOT NULL AND t.lyrics <> '') AS has_lyrics,
            COALESCE(t.cover_url, al.cover_url) AS cover_url, al.id AS album_id, al.title AS album_title,
            COALESCE((SELECT json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY ta.role, ta.position)
               FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
              WHERE ta.track_id = t.id AND ta.role IN ('main','featured')), '[]') AS artists,
            EXISTS (SELECT 1 FROM library_items li WHERE li.user_id = $2 AND li.item_type = 'track' AND li.item_id = t.id) AS liked
       FROM tracks t LEFT JOIN albums al ON al.id = t.album_id
      WHERE t.id = ANY($1::uuid[])`,
    [uniq, user?.id || null]
  );
  const map = new Map(rows.map((r) => [r.id, shapeTrack(r, user)]));
  return ids.map((id) => map.get(id)).filter(Boolean);
}

export function shapeTrack(r, user) {
  const blocked = r.status !== 'active' || (r.explicit && user && user.explicit_allowed === false);
  return {
    id: r.id,
    title: r.title,
    duration_ms: r.duration_ms,
    explicit: r.explicit,
    source: r.source,
    youtube_id: r.source === 'youtube' ? r.youtube_id : undefined,
    playable: !blocked,
    unavailable_reason: r.status !== 'active' ? 'Retirada do catálogo' : blocked ? 'Conteúdo explícito bloqueado' : undefined,
    downloadable: r.source === 'file' && !blocked,
    popularity: r.popularity,
    track_number: r.track_number,
    has_lyrics: r.has_lyrics,
    cover_url: r.cover_url,
    album: r.album_id ? { id: r.album_id, title: r.album_title } : null,
    artists: r.artists || [],
    liked: !!r.liked,
  };
}

export const ARTIST_JSON = `COALESCE((SELECT json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY aa.position)
  FROM album_artists aa JOIN artists a ON a.id = aa.artist_id WHERE aa.album_id = al.id), '[]')`;

export async function albumCards(whereSql, params, limit = 20) {
  return q(
    `SELECT al.id, al.title, al.type, al.release_date, al.cover_url, ${ARTIST_JSON} AS artists
       FROM albums al
      WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = al.id AND t.status = 'active') AND (${whereSql})
      ORDER BY al.release_date DESC NULLS LAST, al.created_at DESC LIMIT ${Number(limit)}`,
    params
  );
}

/** Capa automática: as 4 primeiras capas distintas das faixas. */
export const MOSAIC_SQL = `(SELECT COALESCE(json_agg(x.cov ORDER BY x.mp), '[]') FROM (
   SELECT COALESCE(t.cover_url, al.cover_url) AS cov, min(pi.position) AS mp
     FROM playlist_items pi JOIN tracks t ON t.id = pi.track_id LEFT JOIN albums al ON al.id = t.album_id
    WHERE pi.playlist_id = p.id AND COALESCE(t.cover_url, al.cover_url) IS NOT NULL
    GROUP BY 1 ORDER BY 2 LIMIT 4) x)`;

export async function playlistCards(whereSql, params, { limit = 50, order = 'p.updated_at DESC' } = {}) {
  const rows = await q(
    `SELECT p.id, p.name, p.description, p.cover_url, p.visibility, p.is_collaborative, p.owner_id,
            u.display_name AS owner_name,
            (SELECT count(*) FROM playlist_items pi WHERE pi.playlist_id = p.id)::int AS track_count,
            ${MOSAIC_SQL} AS mosaic
       FROM playlists p JOIN users u ON u.id = p.owner_id
      WHERE p.deleted_at IS NULL AND (${whereSql})
      ORDER BY ${order} LIMIT ${Number(limit)}`,
    params
  );
  return rows.map((r) => ({ ...r, mosaic: (r.mosaic || []).slice(0, 4) }));
}
