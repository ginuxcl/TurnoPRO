// Arranca API (4000) y cliente Vite (5173) juntos. Ctrl+C detiene ambos.
import { spawn } from 'node:child_process';

const procs = [];

function run(name, cmd, args, cwd, color) {
  const p = spawn(cmd, args, { cwd, shell: true, env: process.env });
  const tag = `\x1b[${color}m[${name}]\x1b[0m`;
  p.stdout.on('data', (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `${tag} ${l}\n`).join('')));
  p.stderr.on('data', (d) => process.stderr.write(String(d).split('\n').filter(Boolean).map((l) => `${tag} ${l}\n`).join('')));
  p.on('exit', (code) => console.log(`${tag} terminó con código ${code}`));
  procs.push(p);
  return p;
}

console.log('▶ TurnoPro — arrancando API y cliente…\n');
run('api', 'npm', ['run', 'dev'], 'server', '36');
run('web', 'npm', ['run', 'dev'], 'client', '35');
console.log('\n➡ Web:   http://localhost:5173\n➡ API:   http://localhost:4000/api/v1/health\n');

const killAll = () => {
  for (const p of procs) { try { p.kill('SIGINT'); } catch { /* ya muerto */ } }
  process.exit(0);
};
process.on('SIGINT', killAll);
process.on('SIGTERM', killAll);
