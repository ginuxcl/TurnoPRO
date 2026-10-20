import pg from 'pg';
import { config } from './config.js';

// Fechas y horas como texto 'YYYY-MM-DD' / 'HH:MM:SS' — sin conversiones de zona horaria
pg.types.setTypeParser(1082, (v) => v); // DATE
pg.types.setTypeParser(1083, (v) => v); // TIME

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] error inesperado del pool:', err.message);
});

// Helper: transacción
export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export const q = (text, params) => pool.query(text, params);
