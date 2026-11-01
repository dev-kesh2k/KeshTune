/**
 * Eventos em tempo real (seção 8.4) via Server-Sent Events.
 * Entre réplicas, os eventos passam por LISTEN/NOTIFY do PostgreSQL.
 */
import pg from 'pg';
import { pool } from './db.js';

const clients = new Set(); // { userId, res }
const CHANNEL = 'spotifyx_events';

function deliver(msg) {
  const { event, data, users } = msg;
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (users && !users.includes(c.userId)) continue;
    try {
      c.res.write(line);
    } catch { /* conexão caiu */ }
    if (event === 'account.restricted' && users?.includes(c.userId)) c.res.end();
  }
}

/** Publica um evento para os usuários indicados (null = todos). */
export async function emit(event, data, users = null) {
  const payload = JSON.stringify({ event, data, users });
  try {
    await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]);
  } catch (e) {
    console.error('[realtime] notify falhou, entregando localmente:', e.message);
    deliver({ event, data, users });
  }
}

let listener = null;
export async function startRealtime() {
  const connect = async () => {
    try {
      listener = new pg.Client({ connectionString: process.env.DATABASE_URL });
      listener.on('notification', (n) => {
        try {
          deliver(JSON.parse(n.payload));
        } catch { /* ignora */ }
      });
      listener.on('error', () => {});
      listener.on('end', () => setTimeout(connect, 3000));
      await listener.connect();
      await listener.query(`LISTEN ${CHANNEL}`);
    } catch (e) {
      console.error('[realtime] LISTEN falhou, tentando de novo:', e.message);
      setTimeout(connect, 5000);
    }
  };
  await connect();
  setInterval(() => {
    for (const c of clients) {
      try { c.res.write(': ping\n\n'); } catch { /* */ }
    }
  }, 25000).unref();
}

export function sseHandler(userId, req, res) {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`retry: 3000\nevent: ready\ndata: {}\n\n`);
  const client = { userId, res };
  clients.add(client);
  req.on('close', () => clients.delete(client));
}
