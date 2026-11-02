import express from 'express';
import { one, q } from '../db.js';
import {
  auth, audit, createSession, forgetUser, hashPassword, newTotpSecret, openTotp, passwordProblem,
  rotateSession, sealTotp, verifyPassword, verifyTotp,
} from '../security.js';
import { ah, bad, HttpError, rateLimiter, str } from '../util.js';
import { emit } from '../realtime.js';

export const authRouter = express.Router();

const loginLimiter = rateLimiter({ windowMs: 60000, max: 20, key: (req) => `login:${req.ip}`, message: 'Muitas tentativas de login; aguarde um minuto' });
const MAX_FAILS = 5;
const LOCK_MIN = 15;

authRouter.post('/auth/login', loginLimiter, ah(async (req, res) => {
  const email = str(req.body?.email, 'E-mail', { required: true, max: 254 }).toLowerCase();
  const password = String(req.body?.password || '');
  if (!password) throw bad('Informe a senha');
  const u = await one(`SELECT * FROM users WHERE lower(email) = $1 AND deleted_at IS NULL`, [email]);
  const fail = () => new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos');
  if (!u) {
    await verifyPassword(password, 'scrypt$32768$8$1$AAAA$AAAA'); // tempo constante
    throw fail();
  }
  if (u.locked_until && u.locked_until > new Date()) {
    const min = Math.ceil((u.locked_until - Date.now()) / 60000);
    throw new HttpError(423, 'ACCOUNT_LOCKED', `Conta travada por excesso de tentativas. Tente em ${min} min.`);
  }
  if (!(await verifyPassword(password, u.password_hash))) {
    const fails = u.failed_logins + 1;
    await q(`UPDATE users SET failed_logins = $2, locked_until = $3 WHERE id = $1`, [
      u.id, fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000) : null,
    ]);
    if (fails >= MAX_FAILS) {
      await audit({ ip: req.ip, user: { id: u.id } }, 'auth.locked', 'user', u.id);
      throw new HttpError(423, 'ACCOUNT_LOCKED', `Conta travada por ${LOCK_MIN} min após ${MAX_FAILS} tentativas erradas.`);
    }
    throw fail();
  }
  if (u.status !== 'active') throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'Conta bloqueada. Fale com o administrador.');
  if (u.totp_enabled) {
    const otp = req.body?.otp;
    if (!otp) throw new HttpError(401, 'OTP_REQUIRED', 'Informe o código do autenticador');
    if (!verifyTotp(openTotp(u.totp_secret), otp)) {
      const fails = u.failed_logins + 1;
      await q(`UPDATE users SET failed_logins = $2, locked_until = $3 WHERE id = $1`, [
        u.id, fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000) : null,
      ]);
      throw new HttpError(401, 'OTP_INVALID', 'Código do autenticador incorreto');
    }
  }
  await q(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [u.id]);
  const tokens = await createSession(u, req);
  res.json({ ...tokens, must_change_password: u.must_change_password });
}));

authRouter.post('/auth/refresh', ah(async (req, res) => {
  res.json(await rotateSession(req.body?.refresh_token, req));
}));

authRouter.post('/auth/logout', auth({ allowPendingPassword: true }), ah(async (req, res) => {
  await q(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [req.user.session_id]);
  forgetUser(req.user.id);
  res.json({ ok: true });
}));

authRouter.post('/auth/logout-all', auth(), ah(async (req, res) => {
  await q(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2`, [req.user.id, req.user.session_id]);
  await audit(req, 'auth.logout_all', 'user', req.user.id);
  res.json({ ok: true });
}));

authRouter.post('/auth/change-password', auth({ allowPendingPassword: true }), ah(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const u = await one(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  if (!(await verifyPassword(String(current_password || ''), u.password_hash))) throw bad('Senha atual incorreta', 'INVALID_CREDENTIALS');
  const problem = passwordProblem(new_password);
  if (problem) throw bad(problem);
  if (new_password === current_password) throw bad('A nova senha deve ser diferente da atual');
  await q(`UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1`, [req.user.id, await hashPassword(new_password)]);
  // encerra as outras sessões
  await q(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2`, [req.user.id, req.user.session_id]);
  forgetUser(req.user.id);
  await audit(req, 'auth.change_password', 'user', req.user.id);
  res.json({ ok: true });
}));

// ----- 2FA (TOTP) -----
authRouter.post('/auth/2fa/setup', auth(), ah(async (req, res) => {
  const u = await one(`SELECT email, totp_enabled FROM users WHERE id = $1`, [req.user.id]);
  if (u.totp_enabled) throw bad('A verificação em duas etapas já está ativa');
  const secret = newTotpSecret();
  await q(`UPDATE users SET totp_secret = $2 WHERE id = $1`, [req.user.id, sealTotp(secret)]);
  const label = encodeURIComponent(`KeshTune:${u.email}`);
  res.json({ secret, otpauth_url: `otpauth://totp/${label}?secret=${secret}&issuer=Spotify%20X&digits=6&period=30` });
}));
authRouter.post('/auth/2fa/enable', auth(), ah(async (req, res) => {
  const u = await one(`SELECT totp_secret, totp_enabled FROM users WHERE id = $1`, [req.user.id]);
  if (!u.totp_secret) throw bad('Gere o código QR primeiro');
  if (!verifyTotp(openTotp(u.totp_secret), req.body?.otp)) throw bad('Código incorreto', 'OTP_INVALID');
  await q(`UPDATE users SET totp_enabled = true WHERE id = $1`, [req.user.id]);
  await audit(req, 'auth.2fa_enable', 'user', req.user.id);
  res.json({ ok: true });
}));
authRouter.post('/auth/2fa/disable', auth(), ah(async (req, res) => {
  const u = await one(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  if (!(await verifyPassword(String(req.body?.password || ''), u.password_hash))) throw bad('Senha incorreta', 'INVALID_CREDENTIALS');
  await q(`UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1`, [req.user.id]);
  await audit(req, 'auth.2fa_disable', 'user', req.user.id);
  res.json({ ok: true });
}));

export async function restrictUser(userId) {
  await q(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  await q(`UPDATE offline_licenses SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  forgetUser(userId);
  await emit('account.restricted', { user_id: userId }, [userId]);
}
