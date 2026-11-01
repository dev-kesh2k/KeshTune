import express from 'express';
import { one, q } from '../db.js';
import { auth, audit, forgetUser, verifyPassword } from '../security.js';
import { ah, bad, notFound, oneOf, str, uuidParam } from '../util.js';
import { hydrateTracks, playlistCards } from '../views.js';
import { restrictUser } from './auth.js';
import { isImageRef } from './media.js';

export const meRouter = express.Router();

const ME_SQL = `SELECT id, email, display_name, role, must_change_password, locale, avatar_url, bio, totp_enabled,
  personalization, explicit_allowed, created_at FROM users WHERE id = $1`;

meRouter.get('/me', auth({ allowPendingPassword: true }), ah(async (req, res) => {
  res.json(await one(ME_SQL, [req.user.id]));
}));

meRouter.patch('/me', auth(), ah(async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const vals = [req.user.id];
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (b.display_name !== undefined) set('display_name', str(b.display_name, 'Nome', { required: true, min: 2, max: 80 }));
  if (b.bio !== undefined) set('bio', str(b.bio, 'Bio', { max: 300 }));
  if (b.locale !== undefined) set('locale', oneOf(b.locale, 'Idioma', ['pt-BR', 'en', 'es'], 'pt-BR'));
  if (b.avatar_url !== undefined) {
    if (b.avatar_url && !isImageRef(b.avatar_url)) throw bad('Imagem inválida');
    set('avatar_url', b.avatar_url || null);
  }
  if (b.personalization !== undefined) set('personalization', !!b.personalization);
  if (b.explicit_allowed !== undefined) set('explicit_allowed', !!b.explicit_allowed);
  if (!sets.length) throw bad('Nada para alterar');
  await q(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, vals);
  forgetUser(req.user.id);
  res.json(await one(ME_SQL, [req.user.id]));
}));

/** Exclusão da conta pelo próprio titular (LGPD): lógica, dados pessoais apagados em 30 dias. */
meRouter.delete('/me', auth(), ah(async (req, res) => {
  const u = await one(`SELECT password_hash, role FROM users WHERE id = $1`, [req.user.id]);
  if (!(await verifyPassword(String(req.body?.password || ''), u.password_hash))) throw bad('Senha incorreta', 'INVALID_CREDENTIALS');
  if (u.role === 'admin') {
    const { n } = await one(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND deleted_at IS NULL AND status = 'active'`);
    if (n <= 1) throw bad('Você é o único administrador; crie outro antes de excluir sua conta');
  }
  await q(`UPDATE users SET deleted_at = now() WHERE id = $1`, [req.user.id]);
  await q(`UPDATE playlists SET deleted_at = now() WHERE owner_id = $1 AND deleted_at IS NULL`, [req.user.id]);
  await audit(req, 'account.self_delete', 'user', req.user.id);
  await restrictUser(req.user.id);
  res.json({ ok: true });
}));

meRouter.get('/me/sessions', auth(), ah(async (req, res) => {
  const rows = await q(
    `SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`,
    [req.user.id]
  );
  res.json({ items: rows.map((r) => ({ ...r, current: r.id === req.user.session_id })) });
}));
meRouter.delete('/me/sessions/:id', auth(), ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  await q(`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
  forgetUser(req.user.id);
  res.json({ ok: true });
}));

meRouter.get('/me/history', auth(), ah(async (req, res) => {
  const rows = await q(
    `SELECT track_id, played_at, ms_played, context_type, context_id FROM play_history
      WHERE user_id = $1 ORDER BY played_at DESC LIMIT 100`,
    [req.user.id]
  );
  const tracks = await hydrateTracks(rows.map((r) => r.track_id), req.user);
  const map = new Map(tracks.map((t) => [t.id, t]));
  res.json({ items: rows.filter((r) => map.has(r.track_id)).map((r) => ({ ...r, track: map.get(r.track_id) })) });
}));
meRouter.delete('/me/history', auth(), ah(async (req, res) => {
  await q(`DELETE FROM play_history WHERE user_id = $1`, [req.user.id]);
  await q(`DELETE FROM search_history WHERE user_id = $1`, [req.user.id]);
  await audit(req, 'privacy.clear_history', 'user', req.user.id);
  res.json({ ok: true });
}));

/** Portabilidade (LGPD): exporta os dados pessoais em JSON. */
meRouter.get('/me/export', auth(), ah(async (req, res) => {
  const uid = req.user.id;
  const data = {
    exported_at: new Date().toISOString(),
    account: await one(`SELECT id, email, display_name, role, locale, bio, personalization, explicit_allowed, created_at FROM users WHERE id = $1`, [uid]),
    sessions: await q(`SELECT created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = $1`, [uid]),
    devices: await q(`SELECT name, platform, model, created_at, last_seen_at FROM devices WHERE user_id = $1`, [uid]),
    playlists: await q(
      `SELECT p.name, p.description, p.visibility, p.is_collaborative, p.created_at,
              COALESCE((SELECT json_agg(json_build_object('title', t.title, 'isrc', t.isrc, 'added_at', pi.added_at) ORDER BY pi.position)
                 FROM playlist_items pi JOIN tracks t ON t.id = pi.track_id WHERE pi.playlist_id = p.id), '[]') AS tracks
         FROM playlists p WHERE p.owner_id = $1 AND p.deleted_at IS NULL`,
      [uid]
    ),
    library: await q(`SELECT item_type, item_id, saved_at FROM library_items WHERE user_id = $1`, [uid]),
    following_users: await q(`SELECT followee_id, created_at FROM follows WHERE follower_id = $1`, [uid]),
    play_history: await q(
      `SELECT t.title, h.played_at, h.ms_played, h.context_type, h.offline FROM play_history h JOIN tracks t ON t.id = h.track_id
        WHERE h.user_id = $1 ORDER BY h.played_at DESC`,
      [uid]
    ),
    search_history: await q(`SELECT query, created_at FROM search_history WHERE user_id = $1 ORDER BY created_at DESC`, [uid]),
  };
  res.set('Content-Disposition', 'attachment; filename="meus-dados-spotify-x.json"');
  res.json(data);
}));

// ----- Usuários e seguir -----
meRouter.get('/users/:id', auth(), ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const u = await one(
    `SELECT id, display_name, avatar_url, bio, created_at,
            (SELECT count(*) FROM follows f WHERE f.followee_type = 'user' AND f.followee_id = users.id)::int AS followers,
            (SELECT count(*) FROM follows f WHERE f.follower_id = users.id)::int AS following,
            EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $2 AND f.followee_type = 'user' AND f.followee_id = users.id) AS is_following
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id, req.user.id]
  );
  if (!u) throw notFound('Usuário não encontrado', 'USER_NOT_FOUND');
  const playlists = await playlistCards(`p.owner_id = $1 AND p.visibility = 'public' AND NOT p.hidden_by_admin`, [id]);
  res.json({ ...u, playlists });
}));

meRouter.put('/me/follows', auth(), ah(async (req, res) => {
  const id = uuidParam(req.body?.id);
  if (id === req.user.id) throw bad('Você não pode seguir a si mesmo');
  const u = await one(`SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!u) throw notFound('Usuário não encontrado');
  await q(`INSERT INTO follows (follower_id, followee_type, followee_id) VALUES ($1,'user',$2) ON CONFLICT DO NOTHING`, [req.user.id, id]);
  res.json({ ok: true });
}));
meRouter.delete('/me/follows', auth(), ah(async (req, res) => {
  const id = uuidParam(req.body?.id ?? req.query.id);
  await q(`DELETE FROM follows WHERE follower_id = $1 AND followee_type = 'user' AND followee_id = $2`, [req.user.id, id]);
  res.json({ ok: true });
}));
