// Resetea la base de datos: borra el esquema, lo recrea y siembra la demo.
// Uso: npm run db:reset  (desde server/) — la API no debe estar sirviendo datos importantes.
import { pool } from '../src/db.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  console.log('[reset] esquema eliminado y recreado');
  await pool.end();

  const r1 = spawnSync('node', ['src/migrate.js'], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  if (r1.status !== 0) process.exit(r1.status);
  const r2 = spawnSync('node', ['src/seed.js'], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  if (r2.status !== 0) process.exit(r2.status);
}

main().catch((e) => {
  console.error('[reset] error:', e.message);
  process.exit(1);
});
