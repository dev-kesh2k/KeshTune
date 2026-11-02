import pg from 'pg';

pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric → number
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // bigint → number
pg.types.setTypeParser(1082, (v) => v); // date como texto YYYY-MM-DD

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definida');
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // 8 conexões dão folga às rotas que disparam várias consultas em paralelo (busca, início); se o Postgres
  // do Hub for apertado, ajuste por ambiente com DB_POOL_MAX. Sem o timeout, um pool esgotado deixaria a
  // requisição esperando para sempre; com ele, falha em 10 s e o app tenta de novo.
  max: Number(process.env.DB_POOL_MAX) || 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  // Limites da busca com tolerância a erros (operadores <% e % do pg_trgm, que usam o índice; ver routes/search.js)
  options: '-c pg_trgm.word_similarity_threshold=0.45 -c pg_trgm.similarity_threshold=0.3',
});
pool.on('error', (err) => console.error('[pg] erro no pool:', err.message));

export async function q(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}
export async function one(text, params) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      q: async (t, p) => (await client.query(t, p)).rows,
      one: async (t, p) => (await client.query(t, p)).rows[0] || null,
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
