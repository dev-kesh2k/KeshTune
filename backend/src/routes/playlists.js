import express from 'express';
import multer from 'multer';
import { one, q, tx } from '../db.js';
import { auth, audit } from '../security.js';
import { warmMany } from './youtube.js';
import { emit } from '../realtime.js';
import {
  ah, bad, csvEscape, forbidden, HttpError, notFound, oneOf, parseCsv, rateLimiter, splitLines, str, token, uuidList, uuidParam, uuidv7,
} from '../util.js';
import { hydrateTracks, MOSAIC_SQL, playlistCards } from '../views.js';
import { isImageRef } from './media.js';

export const playlistsRouter = express.Router();
playlistsRouter.use('/playlists', auth());

const MAX_ITEMS = 10000;
const MAX_PLAYLISTS = 2000;
const MAX_COLLABS = 200;
const editLimit = rateLimiter({ windowMs: 60000, max: 50, key: (req) => req.user && `pl-edit:${req.user.id}`, message: 'Limite de 50 edições por minuto atingido' });

async function access(id, user, { forEdit = false, ownerOnly = false } = {}) {
  const p = await one(`SELECT * FROM playlists WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!p) throw notFound('Playlist não encontrada', 'PLAYLIST_NOT_FOUND');
  const isOwner = p.owner_id === user.id;
  const collab = isOwner ? null : await one(`SELECT role FROM playlist_collaborators WHERE playlist_id = $1 AND user_id = $2`, [id, user.id]);
  const isCollab = !!collab && p.is_collaborative;
  const canEdit = isOwner || isCollab;
  const canView = canEdit || user.role === 'admin' || (p.visibility !== 'private' && !p.hidden_by_admin);
  if (!canView) throw notFound('Playlist não encontrada', 'PLAYLIST_NOT_FOUND');
  if (ownerOnly && !isOwner) throw forbidden('Só o dono da playlist pode fazer isso');
  if (forEdit && !canEdit) throw forbidden('Você não pode editar esta playlist');
  return { p, isOwner, isCollab, canEdit };
}

async function audience(playlistId) {
  const rows = await q(
    `SELECT owner_id AS id FROM playlists WHERE id = $1
     UNION SELECT user_id FROM playlist_collaborators WHERE playlist_id = $1
     UNION SELECT user_id FROM library_items WHERE item_type = 'playlist' AND item_id = $1`,
    [playlistId]
  );
  return rows.map((r) => r.id);
}

/** Sobe o snapshot_id, avisa os aparelhos e renumera a lista a cada 1.000 operações. */
async function bump(db, id, ops = 1) {
  const r = await db.one(
    `UPDATE playlists SET snapshot_id = snapshot_id + 1, updated_at = now(), ops_since_renumber = ops_since_renumber + $2
      WHERE id = $1 RETURNING snapshot_id, ops_since_renumber`,
    [id, ops]
  );
  if (r.ops_since_renumber >= 1000) await renumber(db, id);
  return r.snapshot_id;
}
async function renumber(db, id) {
  await db.q(`UPDATE playlist_items SET position = position + 1000000000000 WHERE playlist_id = $1`, [id]);
  await db.q(
    `UPDATE playlist_items pi SET position = x.rn FROM (
       SELECT id, row_number() OVER (ORDER BY position) AS rn FROM playlist_items WHERE playlist_id = $1) x
      WHERE pi.id = x.id`,
    [id]
  );
  await db.q(`UPDATE playlists SET ops_since_renumber = 0 WHERE id = $1`, [id]);
}
async function notifyUpdate(id, snapshot) {
  await emit('playlist.updated', { playlist_id: id, snapshot_id: snapshot }, await audience(id));
}

async function playlistDetail(id, user, a) {
  const { p, isOwner, canEdit } = a;
  const items = await q(
    `SELECT pi.id, pi.position, pi.track_id, pi.added_at, pi.added_by, u.display_name AS added_by_name
       FROM playlist_items pi LEFT JOIN users u ON u.id = pi.added_by WHERE pi.playlist_id = $1 ORDER BY pi.position`,
    [id]
  );
  const tracks = await hydrateTracks(items.map((i) => i.track_id), user);
  const tmap = new Map(tracks.map((t) => [t.id, t]));
  const extra = await one(
    `SELECT u.display_name AS owner_name, u.avatar_url AS owner_avatar,
            (SELECT count(*) FROM library_items li WHERE li.item_type = 'playlist' AND li.item_id = $1 AND li.user_id <> $2)::int AS followers,
            EXISTS (SELECT 1 FROM library_items li WHERE li.item_type = 'playlist' AND li.item_id = $1 AND li.user_id = $3) AS in_library,
            ${MOSAIC_SQL} AS mosaic
       FROM playlists p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [id, p.owner_id, user.id]
  );
  const collaborators = p.is_collaborative || isOwner
    ? await q(
        `SELECT c.user_id AS id, u.display_name, u.avatar_url, c.role, c.invited_at FROM playlist_collaborators c
           JOIN users u ON u.id = c.user_id WHERE c.playlist_id = $1 ORDER BY c.invited_at`,
        [id]
      )
    : [];
  return {
    id: p.id, name: p.name, description: p.description, cover_url: p.cover_url, visibility: p.visibility,
    is_collaborative: p.is_collaborative, snapshot_id: p.snapshot_id, owner_id: p.owner_id, created_at: p.created_at,
    updated_at: p.updated_at, hidden_by_admin: p.hidden_by_admin,
    share_token: p.share_token, invite_token: isOwner ? p.invite_token : undefined,
    ...extra, mosaic: (extra.mosaic || []).slice(0, 4),
    is_owner: isOwner, can_edit: canEdit, collaborators,
    items: items.filter((i) => tmap.has(i.track_id)).map((i) => ({
      id: i.id, position: i.position, added_at: i.added_at, added_by: i.added_by, added_by_name: i.added_by_name, track: tmap.get(i.track_id),
    })),
  };
}

// ----- Listar / criar -----
playlistsRouter.get('/playlists', ah(async (req, res) => {
  const editable = req.query.editable === '1';
  const where = editable
    ? `(p.owner_id = $1 OR (p.is_collaborative AND EXISTS (SELECT 1 FROM playlist_collaborators c WHERE c.playlist_id = p.id AND c.user_id = $1)))`
    : `(p.owner_id = $1 OR EXISTS (SELECT 1 FROM playlist_collaborators c WHERE c.playlist_id = p.id AND c.user_id = $1))`;
  res.json({ items: await playlistCards(where, [req.user.id], { limit: MAX_PLAYLISTS }) });
}));

async function createPlaylist(db, user, { name, description, visibility, is_collaborative, folder_id }) {
  const { n } = await db.one(`SELECT count(*)::int AS n FROM playlists WHERE owner_id = $1 AND deleted_at IS NULL`, [user.id]);
  if (n >= MAX_PLAYLISTS) throw bad(`Limite de ${MAX_PLAYLISTS} playlists atingido`, 'LIMIT_REACHED');
  const id = uuidv7();
  await db.q(
    `INSERT INTO playlists (id, owner_id, name, description, visibility, is_collaborative, share_token) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, user.id, name, description, visibility, is_collaborative, token(12)]
  );
  await db.q(`INSERT INTO playlist_collaborators (playlist_id, user_id, role) VALUES ($1,$2,'owner')`, [id, user.id]);
  let folder = null;
  if (folder_id) {
    const f = await db.one(`SELECT id FROM folders WHERE id = $1 AND user_id = $2`, [uuidParam(folder_id, 'folder_id'), user.id]);
    folder = f?.id || null;
  }
  await db.q(`INSERT INTO library_items (user_id, item_type, item_id, folder_id) VALUES ($1,'playlist',$2,$3)`, [user.id, id, folder]);
  return id;
}

playlistsRouter.post('/playlists', editLimit, ah(async (req, res) => {
  const b = req.body || {};
  const data = {
    name: str(b.name, 'Nome', { required: true, max: 100 }),
    description: str(b.description, 'Descrição', { max: 300 }),
    visibility: oneOf(b.visibility, 'Visibilidade', ['private', 'public', 'link'], 'private'),
    is_collaborative: !!b.is_collaborative,
    folder_id: b.folder_id || null,
  };
  const trackIds = b.track_ids ? uuidList(b.track_ids, 'track_ids', 100) : [];
  const id = await tx(async (db) => {
    const pid = await createPlaylist(db, req.user, data);
    if (trackIds.length) await insertItems(db, pid, trackIds, req.user.id, 'end');
    return pid;
  });
  res.status(201).json(await playlistDetail(id, req.user, await access(id, req.user)));
}));

playlistsRouter.get('/playlists/trash', ah(async (req, res) => {
  const rows = await q(
    `SELECT id, name, deleted_at, (SELECT count(*) FROM playlist_items pi WHERE pi.playlist_id = p.id)::int AS track_count
       FROM playlists p WHERE owner_id = $1 AND deleted_at IS NOT NULL AND deleted_at > now() - interval '30 days' ORDER BY deleted_at DESC`,
    [req.user.id]
  );
  res.json({ items: rows });
}));

playlistsRouter.get('/playlists/link/:token', ah(async (req, res) => {
  const p = await one(`SELECT id, visibility FROM playlists WHERE share_token = $1 AND deleted_at IS NULL`, [String(req.params.token).slice(0, 40)]);
  if (!p) throw notFound('Link inválido ou playlist apagada', 'PLAYLIST_NOT_FOUND');
  await access(p.id, req.user);
  res.json({ id: p.id });
}));

// ----- Convite de colaboração -----
playlistsRouter.get('/playlists/invite/:token', ah(async (req, res) => {
  const p = await one(
    `SELECT p.id, p.name, p.is_collaborative, u.display_name AS owner_name, p.owner_id FROM playlists p JOIN users u ON u.id = p.owner_id
      WHERE p.invite_token = $1 AND p.deleted_at IS NULL`,
    [String(req.params.token).slice(0, 40)]
  );
  if (!p || !p.is_collaborative) throw notFound('Convite inválido ou revogado', 'INVITE_NOT_FOUND');
  const member = await one(`SELECT 1 FROM playlist_collaborators WHERE playlist_id = $1 AND user_id = $2`, [p.id, req.user.id]);
  res.json({ id: p.id, name: p.name, owner_name: p.owner_name, already_member: !!member });
}));
playlistsRouter.post('/playlists/invite/:token/accept', ah(async (req, res) => {
  const p = await one(`SELECT id, is_collaborative FROM playlists WHERE invite_token = $1 AND deleted_at IS NULL`, [String(req.params.token).slice(0, 40)]);
  if (!p || !p.is_collaborative) throw notFound('Convite inválido ou revogado', 'INVITE_NOT_FOUND');
  const { n } = await one(`SELECT count(*)::int AS n FROM playlist_collaborators WHERE playlist_id = $1 AND role = 'editor'`, [p.id]);
  if (n >= MAX_COLLABS) throw bad(`A playlist já tem ${MAX_COLLABS} colaboradores`, 'LIMIT_REACHED');
  await q(`INSERT INTO playlist_collaborators (playlist_id, user_id, role) VALUES ($1,$2,'editor') ON CONFLICT DO NOTHING`, [p.id, req.user.id]);
  await q(`INSERT INTO library_items (user_id, item_type, item_id) VALUES ($1,'playlist',$2) ON CONFLICT DO NOTHING`, [req.user.id, p.id]);
  await notifyUpdate(p.id, null);
  res.json({ id: p.id });
}));

// ----- Importar CSV / M3U -----
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

/** "#EXTINF:123 extras,Artista - Música" -> [linha, "123", "Artista - Música"]; null se a linha não for assim. */
function parseExtinf(l) {
  if (!l.startsWith('#EXTINF:')) return null;
  const rest = l.slice(8);
  const comma = rest.indexOf(',');
  if (comma < 0) return null;
  const secs = /^-?\d+/.exec(rest.slice(0, comma));
  const title = rest.slice(comma + 1);
  if (!secs || splitLines(title).length > 1) return null;
  return [l, secs[0], title];
}

function parseImport(text, filename) {
  const entries = [];
  const isM3u = /^#EXTM3U/m.test(text) || /\.m3u8?$/i.test(filename || '');
  if (isM3u) {
    let pending = null;
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      const m = parseExtinf(l);
      if (m) {
        const [artist, ...rest] = m[2].split(' - ');
        pending = rest.length ? { artist: artist.trim(), title: rest.join(' - ').trim(), duration_s: Number(m[1]) } : { title: m[2].trim(), duration_s: Number(m[1]) };
      } else if (l && !l.startsWith('#')) {
        if (pending) entries.push(pending);
        else entries.push({ title: l.split(/[\\/]/).pop().replace(/\.[a-z0-9]+$/i, '').replace(/^\d+[\s.-]+/, '') });
        pending = null;
      }
    }
    return entries;
  }
  const rows = parseCsv(text);
  if (!rows.length) return entries;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const iT = col('title', 'título', 'titulo', 'track name', 'nome da faixa', 'música', 'musica');
  const iA = col('artist', 'artista');
  const iI = col('isrc');
  const iD = col('duration', 'duração', 'duracao');
  const hasHeader = iT >= 0 || iI >= 0;
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const dur = iD >= 0 ? r[iD] : null;
    let duration_s = null;
    if (dur && /^\d+:\d{2}$/.test(dur.trim())) { const [m, s] = dur.trim().split(':'); duration_s = +m * 60 + +s; }
    else if (dur && /^\d+$/.test(dur.trim())) duration_s = +dur > 10000 ? Math.round(+dur / 1000) : +dur;
    entries.push({
      title: (hasHeader ? r[iT] : r[0])?.trim(),
      artist: (hasHeader ? (iA >= 0 ? r[iA] : '') : r[1] || '')?.trim(),
      isrc: iI >= 0 ? r[iI]?.trim().toUpperCase() : null,
      duration_s,
    });
  }
  return entries.filter((e) => e.title || e.isrc);
}

/** Correspondência: ISRC, depois título + artista + duração (±5 s), depois título + artista. */
async function matchEntry(e) {
  if (e.isrc) {
    const t = await one(`SELECT id FROM tracks WHERE isrc = $1 AND status = 'active'`, [e.isrc]);
    if (t) return t.id;
  }
  if (!e.title) return null;
  const rows = await q(
    `SELECT t.id, t.duration_ms,
            similarity(f_norm(t.title), f_norm($1)) AS ts,
            COALESCE((SELECT max(similarity(f_norm(a.name), f_norm($2))) FROM track_artists ta JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id), 0) AS asim
       FROM tracks t WHERE t.status = 'active' AND similarity(f_norm(t.title), f_norm($1)) > 0.45
      ORDER BY ts DESC LIMIT 10`,
    [e.title, e.artist || '']
  );
  const ok = rows.filter((r) => !e.artist || r.asim > 0.4);
  const byDur = e.duration_s ? ok.find((r) => Math.abs(r.duration_ms / 1000 - e.duration_s) <= 5) : null;
  return (byDur || ok[0])?.id || null;
}

playlistsRouter.post('/playlists/import', editLimit, importUpload.single('file'), ah(async (req, res) => {
  const text = req.file ? req.file.buffer.toString('utf8') : String(req.body?.text || '');
  if (!text.trim()) throw bad('Envie um arquivo CSV ou M3U');
  const entries = parseImport(text.replace(/^﻿/, ''), req.file?.originalname).slice(0, MAX_ITEMS);
  if (!entries.length) throw bad('Nenhuma faixa encontrada no arquivo');
  const name = str(req.body?.name, 'Nome', { max: 100 }) || (req.file?.originalname || 'Playlist importada').replace(/\.[^.]+$/, '').slice(0, 100);
  const matched = [];
  const unmatched = [];
  for (const e of entries) {
    const id = await matchEntry(e);
    if (id) matched.push(id); else unmatched.push(e.artist ? `${e.artist} - ${e.title}` : e.title || e.isrc);
  }
  const id = await tx(async (db) => {
    const pid = await createPlaylist(db, req.user, { name, description: 'Importada de arquivo', visibility: 'private', is_collaborative: false });
    for (let i = 0; i < matched.length; i += 500) await insertItems(db, pid, matched.slice(i, i + 500), req.user.id, 'end');
    return pid;
  });
  await audit(req, 'playlist.import', 'playlist', id, { total: entries.length, matched: matched.length });
  res.status(201).json({ id, total: entries.length, matched: matched.length, unmatched: unmatched.slice(0, 200) });
}));

// ----- Ler / editar / excluir -----
playlistsRouter.get('/playlists/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const detail = await playlistDetail(id, req.user, await access(id, req.user));
  res.json(detail);
  // As primeiras do YouTube já ficam prontas (quem abre a playlist costuma tocar logo)
  warmMany((detail.items || []).map((i) => i.track || i), 3);
}));

playlistsRouter.patch('/playlists/:id', editLimit, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  await access(id, req.user, { ownerOnly: true });
  const b = req.body || {};
  const sets = [];
  const vals = [id];
  const set = (c, v) => { vals.push(v); sets.push(`${c} = $${vals.length}`); };
  if (b.name !== undefined) set('name', str(b.name, 'Nome', { required: true, max: 100 }));
  if (b.description !== undefined) set('description', str(b.description, 'Descrição', { max: 300 }));
  if (b.visibility !== undefined) set('visibility', oneOf(b.visibility, 'Visibilidade', ['private', 'public', 'link']));
  if (b.is_collaborative !== undefined) set('is_collaborative', !!b.is_collaborative);
  if (b.cover_url !== undefined) {
    if (b.cover_url && !isImageRef(b.cover_url)) throw bad('Capa inválida');
    set('cover_url', b.cover_url || null);
  }
  if (!sets.length) throw bad('Nada para alterar');
  const snap = await tx(async (db) => {
    await db.q(`UPDATE playlists SET ${sets.join(', ')} WHERE id = $1`, vals);
    return bump(db, id, 0);
  });
  await notifyUpdate(id, snap);
  res.json(await playlistDetail(id, req.user, await access(id, req.user)));
}));

playlistsRouter.delete('/playlists/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { isOwner } = await access(id, req.user);
  if (!isOwner) {
    // não-dono: "remover da biblioteca" e sair da colaboração
    await q(`DELETE FROM library_items WHERE user_id = $1 AND item_type = 'playlist' AND item_id = $2`, [req.user.id, id]);
    await q(`DELETE FROM playlist_collaborators WHERE playlist_id = $1 AND user_id = $2 AND role = 'editor'`, [id, req.user.id]);
    await emit('library.changed', { type: 'playlist' }, [req.user.id]);
    return res.json({ ok: true, removed_from_library: true });
  }
  const who = await audience(id);
  await q(`UPDATE playlists SET deleted_at = now() WHERE id = $1`, [id]);
  await emit('playlist.updated', { playlist_id: id, deleted: true }, who);
  res.json({ ok: true, deleted: true });
}));

playlistsRouter.post('/playlists/:id/restore', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const p = await one(`SELECT id FROM playlists WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL AND deleted_at > now() - interval '30 days'`, [id, req.user.id]);
  if (!p) throw notFound('Playlist não encontrada na lixeira');
  await q(`UPDATE playlists SET deleted_at = NULL, updated_at = now() WHERE id = $1`, [id]);
  await q(`INSERT INTO library_items (user_id, item_type, item_id) VALUES ($1,'playlist',$2) ON CONFLICT DO NOTHING`, [req.user.id, id]);
  await emit('library.changed', { type: 'playlist' }, [req.user.id]);
  res.json({ ok: true });
}));

// ----- Itens -----
async function insertItems(db, id, trackIds, userId, where) {
  const { n } = await db.one(`SELECT count(*)::int AS n FROM playlist_items WHERE playlist_id = $1`, [id]);
  if (n + trackIds.length > MAX_ITEMS) throw bad(`Limite de ${MAX_ITEMS} faixas por playlist`, 'LIMIT_REACHED');
  const found = await db.q(`SELECT id FROM tracks WHERE id = ANY($1::uuid[])`, [trackIds]);
  if (found.length !== new Set(trackIds).size) throw bad('Alguma faixa não existe', 'TRACK_NOT_FOUND');
  const ext = await db.one(`SELECT min(position) AS mn, max(position) AS mx FROM playlist_items WHERE playlist_id = $1`, [id]);
  const start = where === 'start' ? (ext.mn ?? 1) - trackIds.length : (ext.mx ?? 0) + 1;
  const values = [];
  const params = [id, userId];
  trackIds.forEach((t, i) => {
    params.push(uuidv7(), start + i, t);
    const k = params.length;
    values.push(`($${k - 2}, $1, $${k - 1}, $${k}, $2)`);
  });
  await db.q(`INSERT INTO playlist_items (id, playlist_id, position, track_id, added_by) VALUES ${values.join(',')}`, params);
}

/** Cria uma playlist privada do usuário já com as faixas (ex.: importada do YouTube). Devolve o id. */
export async function createPlaylistWithTracks(user, { name, description }, trackIds) {
  const id = await tx(async (db) => {
    const pid = await createPlaylist(db, user, { name, description, visibility: 'private', is_collaborative: false });
    if (trackIds.length) await insertItems(db, pid, trackIds, user.id, 'end');
    return pid;
  });
  await emit('library.changed', { type: 'playlist' }, [user.id]);
  return id;
}

/** Coloca faixas baixadas na playlist "Minhas músicas" do usuário (criada no primeiro download), mais recentes no topo. */
export async function addToMyMusic(user, trackIds) {
  const ids = [...new Set(trackIds)];
  if (!ids.length) return;
  const r = await tx(async (db) => {
    await db.q(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`my_music:${user.id}`]);
    let p = await db.one(
      `SELECT id FROM playlists WHERE owner_id = $1 AND system_key = 'my_music' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      [user.id]
    );
    const isNew = !p;
    if (!p) {
      p = { id: await createPlaylist(db, user, { name: 'Minhas músicas', description: 'Músicas que você baixou', visibility: 'private', is_collaborative: false }) };
      await db.q(`UPDATE playlists SET system_key = 'my_music' WHERE id = $1`, [p.id]);
    }
    const have = new Set((await db.q(`SELECT track_id FROM playlist_items WHERE playlist_id = $1 AND track_id = ANY($2::uuid[])`, [p.id, ids])).map((x) => x.track_id));
    const toAdd = ids.filter((t) => !have.has(t));
    if (!toAdd.length) return { id: p.id, isNew, snap: null };
    await insertItems(db, p.id, toAdd, user.id, 'start');
    return { id: p.id, isNew, snap: await bump(db, p.id, toAdd.length) };
  });
  if (r.isNew) await emit('library.changed', { type: 'playlist' }, [user.id]);
  if (r.snap) await notifyUpdate(r.id, r.snap);
}

playlistsRouter.post('/playlists/:id/items', editLimit, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  await access(id, req.user, { forEdit: true });
  const trackIds = uuidList(req.body?.track_ids, 'track_ids', 100);
  const where = oneOf(req.body?.position, 'position', ['start', 'end'], 'end');
  const dupMode = oneOf(req.body?.duplicates, 'duplicates', ['ask', 'add', 'skip'], 'ask');
  const existing = new Set((await q(`SELECT track_id FROM playlist_items WHERE playlist_id = $1 AND track_id = ANY($2::uuid[])`, [id, trackIds])).map((r) => r.track_id));
  if (existing.size && dupMode === 'ask') {
    throw new HttpError(409, 'DUPLICATE_TRACKS', existing.size === 1 ? 'Esta faixa já está na playlist' : `${existing.size} faixas já estão na playlist`, { duplicates: [...existing] });
  }
  const toAdd = dupMode === 'skip' ? trackIds.filter((t) => !existing.has(t)) : trackIds;
  if (!toAdd.length) return res.json({ added: 0, snapshot_id: (await one(`SELECT snapshot_id FROM playlists WHERE id = $1`, [id])).snapshot_id });
  const snap = await tx(async (db) => {
    await insertItems(db, id, toAdd, req.user.id, where);
    return bump(db, id, toAdd.length);
  });
  await notifyUpdate(id, snap);
  res.status(201).json({ added: toAdd.length, snapshot_id: snap });
}));

playlistsRouter.delete('/playlists/:id/items', editLimit, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  await access(id, req.user, { forEdit: true });
  const itemIds = uuidList(req.body?.item_ids, 'item_ids', 500);
  // remoção comutativa: itens já removidos por outro aparelho são ignorados
  const snap = await tx(async (db) => {
    await db.q(`DELETE FROM playlist_items WHERE playlist_id = $1 AND id = ANY($2::uuid[])`, [id, itemIds]);
    return bump(db, id, itemIds.length);
  });
  await notifyUpdate(id, snap);
  res.json({ removed: itemIds.length, snapshot_id: snap });
}));

/** Reordenar um item para entre dois vizinhos (posição fracionária). */
playlistsRouter.put('/playlists/:id/items/reorder', editLimit, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  await access(id, req.user, { forEdit: true });
  const itemId = uuidParam(req.body?.item_id, 'item_id');
  const beforeId = req.body?.before_item_id ? uuidParam(req.body.before_item_id, 'before_item_id') : null; // fica antes deste
  const snap = await tx(async (db) => {
    const item = await db.one(`SELECT id FROM playlist_items WHERE id = $1 AND playlist_id = $2 FOR UPDATE`, [itemId, id]);
    if (!item) throw notFound('Item não está mais na playlist (outro aparelho removeu)', 'ITEM_NOT_FOUND');
    const compute = async () => {
      if (!beforeId) {
        const r = await db.one(`SELECT max(position) AS mx FROM playlist_items WHERE playlist_id = $1 AND id <> $2`, [id, itemId]);
        return (r.mx ?? 0) + 1;
      }
      const before = await db.one(`SELECT position FROM playlist_items WHERE id = $1 AND playlist_id = $2`, [beforeId, id]);
      if (!before) throw notFound('Item de referência não existe mais', 'ITEM_NOT_FOUND');
      const prev = await db.one(
        `SELECT max(position) AS p FROM playlist_items WHERE playlist_id = $1 AND position < $2 AND id <> $3`,
        [id, before.position, itemId]
      );
      const lo = prev.p ?? before.position - 2;
      const mid = (Number(lo) + Number(before.position)) / 2;
      if (Math.abs(before.position - mid) < 1e-6) return null;
      return Math.round(mid * 1e8) / 1e8;
    };
    let pos = await compute();
    if (pos === null) { await renumber(db, id); pos = await compute(); }
    await db.q(`UPDATE playlist_items SET position = $3 WHERE id = $1 AND playlist_id = $2`, [itemId, id, pos]);
    return bump(db, id, 1);
  });
  await notifyUpdate(id, snap);
  res.json({ snapshot_id: snap });
}));

/** Ordenar a lista inteira (título, artista, álbum, data de adição, duração). */
playlistsRouter.put('/playlists/:id/items/sort', editLimit, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  await access(id, req.user, { forEdit: true });
  const by = oneOf(req.body?.by, 'by', ['title', 'artist', 'album', 'added_at', 'duration'], 'title');
  const dir = req.body?.dir === 'desc' ? 'DESC' : 'ASC';
  const expr = {
    title: 'f_norm(t.title)',
    artist: `f_norm(COALESCE((SELECT a.name FROM track_artists ta JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = t.id AND ta.role = 'main' ORDER BY ta.position LIMIT 1), ''))`,
    album: `f_norm(COALESCE(al.title, ''))`,
    added_at: 'pi.added_at',
    duration: 't.duration_ms',
  }[by];
  const snap = await tx(async (db) => {
    await db.q(`UPDATE playlist_items SET position = position + 1000000000000 WHERE playlist_id = $1`, [id]);
    await db.q(
      `UPDATE playlist_items x SET position = s.rn FROM (
         SELECT pi.id, row_number() OVER (ORDER BY ${expr} ${dir}, pi.added_at) AS rn
           FROM playlist_items pi JOIN tracks t ON t.id = pi.track_id LEFT JOIN albums al ON al.id = t.album_id
          WHERE pi.playlist_id = $1) s WHERE x.id = s.id`,
      [id]
    );
    await db.q(`UPDATE playlists SET ops_since_renumber = 0 WHERE id = $1`, [id]);
    return bump(db, id, 0);
  });
  await notifyUpdate(id, snap);
  res.json({ snapshot_id: snap });
}));

// ----- Colaboração, compartilhamento, seguir -----
playlistsRouter.post('/playlists/:id/collaborators', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { p } = await access(id, req.user, { ownerOnly: true });
  let inviteToken = p.invite_token;
  if (!inviteToken || req.body?.regenerate) {
    inviteToken = token(16);
    await q(`UPDATE playlists SET invite_token = $2, is_collaborative = true WHERE id = $1`, [id, inviteToken]);
  } else if (!p.is_collaborative) await q(`UPDATE playlists SET is_collaborative = true WHERE id = $1`, [id]);
  res.json({ invite_token: inviteToken });
}));
playlistsRouter.delete('/playlists/:id/invite', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  await access(id, req.user, { ownerOnly: true });
  await q(`UPDATE playlists SET invite_token = NULL WHERE id = $1`, [id]);
  res.json({ ok: true });
}));
playlistsRouter.delete('/playlists/:id/collaborators/:userId', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const userId = uuidParam(req.params.userId, 'userId');
  if (userId !== req.user.id) await access(id, req.user, { ownerOnly: true });
  await q(`DELETE FROM playlist_collaborators WHERE playlist_id = $1 AND user_id = $2 AND role = 'editor'`, [id, userId]);
  await notifyUpdate(id, null);
  res.json({ ok: true });
}));

playlistsRouter.post('/playlists/:id/share', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { p, isOwner } = await access(id, req.user);
  if (p.visibility === 'private' && isOwner && req.body?.make_link) {
    await q(`UPDATE playlists SET visibility = 'link' WHERE id = $1`, [id]);
  }
  res.json({ share_token: p.share_token, visibility: req.body?.make_link && isOwner && p.visibility === 'private' ? 'link' : p.visibility });
}));

playlistsRouter.put('/playlists/:id/follow', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { p } = await access(id, req.user);
  if (p.owner_id === req.user.id) throw bad('A playlist já é sua');
  await q(`INSERT INTO library_items (user_id, item_type, item_id) VALUES ($1,'playlist',$2) ON CONFLICT DO NOTHING`, [req.user.id, id]);
  await emit('library.changed', { type: 'playlist' }, [req.user.id]);
  res.json({ ok: true });
}));
playlistsRouter.delete('/playlists/:id/follow', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  await q(`DELETE FROM library_items WHERE user_id = $1 AND item_type = 'playlist' AND item_id = $2`, [req.user.id, id]);
  await emit('library.changed', { type: 'playlist' }, [req.user.id]);
  res.json({ ok: true });
}));

playlistsRouter.get('/playlists/:id/suggestions', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  await access(id, req.user);
  const rows = await q(
    `WITH cur AS (SELECT track_id FROM playlist_items WHERE playlist_id = $1),
          ar AS (SELECT ta.artist_id, count(*) n FROM track_artists ta JOIN cur ON cur.track_id = ta.track_id GROUP BY 1),
          ge AS (SELECT tg.genre_id, count(*) n FROM track_genres tg JOIN cur ON cur.track_id = tg.track_id GROUP BY 1),
          -- só faixas dos mesmos artistas/gêneros recebem nota (antes: duas subconsultas para cada faixa do catálogo)
          cand AS (SELECT ta.track_id AS id, ar.n * 2 AS s FROM track_artists ta JOIN ar ON ar.artist_id = ta.artist_id
                   UNION ALL SELECT tg.track_id, ge.n FROM track_genres tg JOIN ge ON ge.genre_id = tg.genre_id)
     SELECT t.id FROM cand c JOIN tracks t ON t.id = c.id
      WHERE t.status = 'active' AND t.id NOT IN (SELECT track_id FROM cur)
      GROUP BY t.id, t.popularity
      ORDER BY sum(c.s) DESC, t.popularity DESC, random() LIMIT 10`,
    [id]
  );
  if (rows.length < 10) {
    rows.push(...(await q(
      `SELECT id FROM tracks WHERE status = 'active' AND NOT (id = ANY($2::uuid[]))
          AND id NOT IN (SELECT track_id FROM playlist_items WHERE playlist_id = $1)
        ORDER BY popularity DESC, created_at DESC LIMIT $3`,
      [id, rows.map((r) => r.id), 10 - rows.length]
    )));
  }
  res.json({ items: (await hydrateTracks(rows.map((r) => r.id), req.user)).filter((t) => t.playable) });
}));

playlistsRouter.get('/playlists/:id/export', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { p } = await access(id, req.user);
  const rows = await q(
    `SELECT t.title, t.isrc, t.duration_ms, al.title AS album, pi.added_at,
            (SELECT string_agg(a.name, ', ' ORDER BY ta.position) FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
              WHERE ta.track_id = t.id AND ta.role IN ('main','featured')) AS artists
       FROM playlist_items pi JOIN tracks t ON t.id = pi.track_id LEFT JOIN albums al ON al.id = t.album_id
      WHERE pi.playlist_id = $1 ORDER BY pi.position`,
    [id]
  );
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;
  const lines = ['Título,Artista,Álbum,ISRC,Duração,Adicionada em'];
  for (const r of rows) lines.push([r.title, r.artists, r.album, r.isrc, fmt(r.duration_ms), r.added_at.toISOString()].map((v) => csvEscape(v)).join(','));
  const fname = p.name.normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'playlist';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${fname}.csv"`);
  res.send(`﻿${lines.join('\r\n')}\r\n`);
}));

