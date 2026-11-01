import { one, q } from './db.js';
import { hashPassword } from './security.js';
import { uuidv7, isEmail } from './util.js';

const GENRES = [
  ['Pop', '#e91e63'], ['Rock', '#e53935'], ['MPB', '#43a047'], ['Sertanejo', '#8d6e63'], ['Funk', '#ab47bc'],
  ['Samba', '#fb8c00'], ['Pagode', '#f4511e'], ['Forró', '#c0ca33'], ['Gospel', '#5c6bc0'], ['Rap / Hip-hop', '#546e7a'],
  ['Eletrônica', '#00acc1'], ['Jazz', '#6d4c41'], ['Clássica', '#7e57c2'], ['Reggae', '#2e7d32'], ['Indie', '#26a69a'],
  ['R&B', '#8e24aa'], ['Axé', '#fdd835'], ['Bossa Nova', '#00897b'], ['Metal', '#424242'], ['Infantil', '#29b6f6'],
];
const MOODS = [
  ['Para relaxar', '#4db6ac'], ['Treino', '#ef5350'], ['Foco', '#5c6bc0'], ['Festa', '#ec407a'],
  ['Romântico', '#d81b60'], ['Para dormir', '#3949ab'], ['Alegria', '#ffb300'], ['Nostalgia', '#8d6e63'],
];
const DEFAULT_SETTINGS = {
  offline_enabled: true,
  youtube_enabled: true,
  max_offline_devices: 5,
  max_offline_tracks: 10000,
  offline_license_days: 30,
};

export async function seed() {
  for (const [name, color] of GENRES) {
    await q(`INSERT INTO genres (name, kind, color) VALUES ($1,'genre',$2) ON CONFLICT (kind, name) DO NOTHING`, [name, color]);
  }
  for (const [name, color] of MOODS) {
    await q(`INSERT INTO genres (name, kind, color) VALUES ($1,'mood',$2) ON CONFLICT (kind, name) DO NOTHING`, [name, color]);
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await q(`INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, [k, JSON.stringify(v)]);
  }

  const email = String(process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.SEED_ADMIN_PASSWORD || '');
  if (!isEmail(email) || password.length < 8) {
    console.warn('[seed] SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD ausentes ou inválidos; admin inicial não criado');
    return;
  }
  const exists = await one(`SELECT id FROM users WHERE lower(email) = $1 AND deleted_at IS NULL`, [email]);
  if (exists) return;
  const anyAdmin = await one(`SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL LIMIT 1`);
  if (anyAdmin) return;
  await q(
    `INSERT INTO users (id, email, password_hash, display_name, role, must_change_password) VALUES ($1,$2,$3,$4,'admin',false)`,
    [uuidv7(), email, await hashPassword(password), String(process.env.SEED_ADMIN_NAME || 'Administrador').slice(0, 80)]
  );
  console.log(`[seed] administrador inicial criado: ${email}`);
}

export async function getSettings() {
  const rows = await q(`SELECT key, value FROM app_settings`);
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}
