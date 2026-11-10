import compression from 'compression';
import express from 'express';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { getSettings, seed } from './seed.js';
import { auth } from './security.js';
import { sseHandler, startRealtime } from './realtime.js';
import { ah, HttpError, rateLimiter, token } from './util.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { mediaRouter } from './routes/media.js';
import { catalogRouter } from './routes/catalog.js';
import { searchRouter } from './routes/search.js';
import { playlistsRouter } from './routes/playlists.js';
import { libraryRouter } from './routes/library.js';
import { playbackRouter } from './routes/playback.js';
import { offlineRouter } from './routes/offline.js';
import { adminRouter } from './routes/admin.js';
import { importsRouter, startImportWorker } from './routes/imports.js';
import { startArtistImageWorker, startMixesWarmup, startOffloadSweeper, youtubeRouter } from './routes/youtube.js';
import { startVideoSweeper, videoRouter } from './routes/video.js';

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(',') : 'loopback');
app.disable('x-powered-by');
app.disable('etag');

const api = express.Router();
api.use((req, res, next) => {
  req.id = req.get('x-request-id') || token(8);
  res.set('X-Request-Id', req.id);
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});
// gzip nas respostas JSON; fica de fora o áudio (já comprimido) e o SSE (precisa sair na hora)
api.use(compression({
  threshold: 1024,
  filter: (req, res) => !req.path.startsWith('/stream/') && !req.path.startsWith('/youtube/stream/') && !req.path.startsWith('/offline/download/') && req.path !== '/events' && compression.filter(req, res),
}));
api.use(express.json({ limit: '1mb' }));

api.get('/health', ah(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, service: 'spotify-x', time: new Date().toISOString() });
}));

// Configuração pública mínima para o app
api.get('/config', ah(async (_req, res) => {
  const s = await getSettings();
  res.json({ offline_enabled: s.offline_enabled, youtube_enabled: s.youtube_enabled, max_offline_devices: s.max_offline_devices, max_offline_tracks: s.max_offline_tracks, server_time: new Date().toISOString() });
}));

// Limite por usuário (spec 8.1): 100 escritas/min; leituras com folga para a navegação no app.
// O streaming de áudio, imagens e downloads offline ficam fora do limite.
const limiterKey = (prefix) => (req) => {
  if (req.path.startsWith('/stream/') || req.path.startsWith('/media/') || req.path.startsWith('/offline/download/') || req.path === '/events') return null;
  const h = req.get('authorization') || '';
  const d = h.startsWith('Bearer ') ? jwt.decode(h.slice(7)) : null;
  return `${prefix}:${d?.sub ? `u:${d.sub}` : `ip:${req.ip}`}`;
};
const writeLimiter = rateLimiter({ windowMs: 60000, max: 100, key: limiterKey('w') });
const readLimiter = rateLimiter({ windowMs: 60000, max: 600, key: limiterKey('r') });
api.use((req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? readLimiter(req, res, next) : writeLimiter(req, res, next)));

// Tempo real (SSE): ticket curto porque o EventSource não envia cabeçalhos
const SECRET = process.env.JWT_SECRET;
api.post('/events/ticket', auth(), (req, res) => {
  res.json({ ticket: jwt.sign({ sub: req.user.id, typ: 'sse' }, SECRET, { expiresIn: 60 }) });
});
api.get('/events', (req, res, next) => {
  try {
    const p = jwt.verify(String(req.query.ticket || ''), SECRET);
    if (p.typ !== 'sse') throw new Error('tipo');
    sseHandler(p.sub, req, res);
  } catch {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Ticket inválido'));
  }
});

for (const r of [authRouter, meRouter, mediaRouter, catalogRouter, searchRouter, playlistsRouter, libraryRouter, playbackRouter, offlineRouter, adminRouter, importsRouter, youtubeRouter, videoRouter]) {
  api.use(r);
}

api.use((req, _res, next) => next(new HttpError(404, 'ROUTE_NOT_FOUND', `Rota não encontrada: ${req.method} ${req.path}`)));

// Formato de erro da spec (8.1): { error: { code, message, request_id } }
// eslint-disable-next-line no-unused-vars
api.use((err, req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  let code = err.code || 'INTERNAL';
  let message = err.message;
  if (err.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'JSON inválido'; }
  if (err.name === 'MulterError') {
    status = 400; code = 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo grande demais' : 'Falha no envio do arquivo';
  }
  if (err.code === '23505') { status = 409; code = 'DUPLICATE'; message = 'Registro duplicado'; }
  if (err.code === '22P02') { status = 400; code = 'INVALID_INPUT'; message = 'Valor inválido'; }
  if (typeof status !== 'number' || status < 400 || status > 599) status = 500;
  if (status >= 500) {
    console.error(`[${req.id}]`, err);
    code = 'INTERNAL';
    message = 'Erro interno. Tente novamente.';
  }
  if (res.headersSent) return res.end();
  res.status(status).json({ error: { code, message, request_id: req.id, ...(err.extra || {}) } });
});

// O proxy pode repassar /api/..., o caminho completo /<slug>/api/... ou já sem prefixo.
const publicPath = String(process.env.PUBLIC_PATH || '').replace(/\/+$/, '');
if (publicPath) app.use(`${publicPath}/api`, api);
app.use('/api', api);
app.use('/v1', api);
app.use(api); // proxy do Hub já tira /<slug>/api

const port = Number(process.env.PORT) || 3000;
(async () => {
  for (let i = 1; ; i++) {
    try {
      await migrate();
      break;
    } catch (e) {
      if (i >= 10) throw e;
      console.error(`[boot] banco indisponível (${e.message}); nova tentativa em 3 s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  await seed();
  await startRealtime();
  startImportWorker();
  startArtistImageWorker();
  startOffloadSweeper();
  startVideoSweeper();
  startMixesWarmup();
  app.listen(port, '0.0.0.0', () => console.log(`KeshTune API em 0.0.0.0:${port} (prefixo ${publicPath || '/'})`));
})().catch((e) => {
  console.error('[boot] falha ao iniciar:', e);
  process.exit(1);
});
