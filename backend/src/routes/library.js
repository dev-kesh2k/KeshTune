import express from 'express';
import { one, q } from '../db.js';
import { auth } from '../security.js';
import { emit } from '../realtime.js';
import { ah, bad, notFound, oneOf, str, uuidList, uuidParam, uuidv7 } from '../util.js';
import { ARTIST_JSON, hydrateTracks, playlistCards } from '../views.js';

export const libraryRouter = express.Router();
libraryRouter.use('/me', auth());

const MAX_LIKES = 10000;
const TABLE = { track: 'tracks', album: 'albums', artist: 'artists' };

libraryRouter.get('/me/library', ah(async (req, res) => {
  const uid = req.user.id;
  const playlists = await playlistCards(
    `(EXISTS (SELECT 1 FROM library_items li WHERE li.user_id = $1 AND li.item_type = 'playlist' AND li.item_id = p.id)
      OR (p.is_collaborative AND EXISTS (SELECT 1 FROM playlist_collaborators c WHERE c.playlist_id = p.id AND c.user_id = $1)))
     AND (p.owner_id = $1 OR p.visibility <> 'private' OR EXISTS (SELECT 1 FROM playlist_collaborators c WHERE c.playlist_id = p.id AND c.user_id = $1))`,
    [uid], { limit: 2000, order: `(SELECT li.saved_at FROM library_items li WHERE li.user_id = $1 AND li.item_type = 'playlist' AND li.item_id = p.id) DESC NULLS LAST` }
  );
  const folderOf = new Map((await q(`SELECT item_id, folder_id, saved_at FROM library_items WHERE user_id = $1 AND item_type = 'playlist'`, [uid])).map((r) => [r.item_id, r]));
  const albums = await q(
    `SELECT al.id, al.title, al.type, al.release_date, al.cover_url, ${ARTIST_JSON} AS artists, li.saved_at
       FROM library_items li JOIN albums al ON al.id = li.item_id WHERE li.user_id = $1 AND li.item_type = 'album' ORDER BY li.saved_at DESC`,
    [uid]
  );
  const artists = await q(
    `SELECT a.id, a.name, a.image_url, li.saved_at FROM library_items li JOIN artists a ON a.id = li.item_id
      WHERE li.user_id = $1 AND li.item_type = 'artist' ORDER BY li.saved_at DESC`,
    [uid]
  );
  const folders = await q(`SELECT id, name, parent_id, created_at FROM folders WHERE user_id = $1 ORDER BY name`, [uid]);
  const { n: liked } = await one(`SELECT count(*)::int AS n FROM library_items WHERE user_id = $1 AND item_type = 'track'`, [uid]);
  res.json({
    liked_count: liked,
    folders,
    playlists: playlists.map((p) => ({ ...p, folder_id: folderOf.get(p.id)?.folder_id || null, saved_at: folderOf.get(p.id)?.saved_at || null })),
    albums,
    artists,
  });
}));

libraryRouter.get('/me/library/tracks', ah(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  const rows = await q(
    `SELECT item_id AS id, saved_at FROM library_items WHERE user_id = $1 AND item_type = 'track'
       AND ($2::timestamptz IS NULL OR saved_at < $2) ORDER BY saved_at DESC LIMIT $3`,
    [req.user.id, req.query.cursor || null, limit]
  );
  const tracks = await hydrateTracks(rows.map((r) => r.id), req.user);
  const savedAt = new Map(rows.map((r) => [r.id, r.saved_at]));
  res.json({
    items: tracks.map((t) => ({ track: t, saved_at: savedAt.get(t.id) })),
    next_cursor: rows.length === limit ? rows[rows.length - 1].saved_at.toISOString() : null,
  });
}));

libraryRouter.put('/me/library/:type', ah(async (req, res) => {
  const type = oneOf(req.params.type, 'tipo', ['track', 'album', 'artist']);
  const ids = uuidList(req.body?.ids, 'ids', 500);
  const exists = await q(`SELECT id FROM ${TABLE[type]} WHERE id = ANY($1::uuid[])`, [ids]);
  if (exists.length !== new Set(ids).size) throw notFound('Item não encontrado');
  if (type === 'track') {
    const { n } = await one(`SELECT count(*)::int AS n FROM library_items WHERE user_id = $1 AND item_type = 'track'`, [req.user.id]);
    if (n + ids.length > MAX_LIKES) throw bad(`Limite de ${MAX_LIKES} músicas curtidas atingido`, 'LIMIT_REACHED');
  }
  await q(
    `INSERT INTO library_items (user_id, item_type, item_id) SELECT $1, $2, x FROM unnest($3::uuid[]) x ON CONFLICT DO NOTHING`,
    [req.user.id, type, ids]
  );
  await emit('library.changed', { type, ids, saved: true }, [req.user.id]);
  res.json({ ok: true });
}));

libraryRouter.delete('/me/library/:type', ah(async (req, res) => {
  const type = oneOf(req.params.type, 'tipo', ['track', 'album', 'artist']);
  const ids = uuidList(req.body?.ids, 'ids', 500);
  await q(`DELETE FROM library_items WHERE user_id = $1 AND item_type = $2 AND item_id = ANY($3::uuid[])`, [req.user.id, type, ids]);
  await emit('library.changed', { type, ids, saved: false }, [req.user.id]);
  res.json({ ok: true });
}));

// ----- Pastas -----
async function checkFolder(id, uid) {
  const f = await one(`SELECT * FROM folders WHERE id = $1 AND user_id = $2`, [id, uid]);
  if (!f) throw notFound('Pasta não encontrada');
  return f;
}
libraryRouter.post('/me/folders', ah(async (req, res) => {
  const name = str(req.body?.name, 'Nome', { required: true, max: 100 });
  const parent = req.body?.parent_id ? (await checkFolder(uuidParam(req.body.parent_id, 'parent_id'), req.user.id)).id : null;
  const { n } = await one(`SELECT count(*)::int AS n FROM folders WHERE user_id = $1`, [req.user.id]);
  if (n >= 500) throw bad('Limite de 500 pastas');
  const id = uuidv7();
  await q(`INSERT INTO folders (id, user_id, parent_id, name) VALUES ($1,$2,$3,$4)`, [id, req.user.id, parent, name]);
  await emit('library.changed', { type: 'folder' }, [req.user.id]);
  res.status(201).json({ id, name, parent_id: parent });
}));
libraryRouter.patch('/me/folders/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  await checkFolder(id, req.user.id);
  const b = req.body || {};
  if (b.name !== undefined) await q(`UPDATE folders SET name = $2 WHERE id = $1`, [id, str(b.name, 'Nome', { required: true, max: 100 })]);
  if (b.parent_id !== undefined) {
    let parent = null;
    if (b.parent_id) {
      parent = uuidParam(b.parent_id, 'parent_id');
      await checkFolder(parent, req.user.id);
      // impede ciclo: o novo pai não pode ser a própria pasta nem descendente dela
      const cyc = await one(
        `WITH RECURSIVE up AS (SELECT id, parent_id FROM folders WHERE id = $1 UNION ALL SELECT f.id, f.parent_id FROM folders f JOIN up ON f.id = up.parent_id)
         SELECT 1 FROM up WHERE id = $2`,
        [parent, id]
      );
      if (cyc) throw bad('Não é possível mover a pasta para dentro dela mesma');
    }
    await q(`UPDATE folders SET parent_id = $2 WHERE id = $1`, [id, parent]);
  }
  await emit('library.changed', { type: 'folder' }, [req.user.id]);
  res.json({ ok: true });
}));
libraryRouter.delete('/me/folders/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const f = await checkFolder(id, req.user.id);
  // as playlists e subpastas sobem para a pasta-mãe
  await q(`UPDATE library_items SET folder_id = $3 WHERE user_id = $1 AND folder_id = $2`, [req.user.id, id, f.parent_id]);
  await q(`UPDATE folders SET parent_id = $3 WHERE user_id = $1 AND parent_id = $2`, [req.user.id, id, f.parent_id]);
  await q(`DELETE FROM folders WHERE id = $1`, [id]);
  await emit('library.changed', { type: 'folder' }, [req.user.id]);
  res.json({ ok: true });
}));
libraryRouter.put('/me/library/playlist/:id/folder', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const folder = req.body?.folder_id ? (await checkFolder(uuidParam(req.body.folder_id, 'folder_id'), req.user.id)).id : null;
  const r = await q(`UPDATE library_items SET folder_id = $3 WHERE user_id = $1 AND item_type = 'playlist' AND item_id = $2 RETURNING item_id`, [req.user.id, id, folder]);
  if (!r.length) {
    // playlist colaborativa sem linha na biblioteca
    await q(`INSERT INTO library_items (user_id, item_type, item_id, folder_id) VALUES ($1,'playlist',$2,$3)`, [req.user.id, id, folder]);
  }
  await emit('library.changed', { type: 'folder' }, [req.user.id]);
  res.json({ ok: true });
}));
