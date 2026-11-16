import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync(new URL('./.env', import.meta.url), 'utf8');
const url = (env.match(/^DATABASE_URL\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) { console.error('falta DATABASE_URL'); process.exit(1); }

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const tablas = ['turnos','turno_procesos','registro_paradas','parada_acciones','lineas_archivadas','recetas','receta_etapas','receta_maquinas','usuarios'];
const salida = {};
for (const t of tablas) {
  const r = await pool.query('select * from ' + t);
  salida[t] = r.rows;
  console.log(t, r.rowCount);
}
const destino = process.argv[2] || 'respaldo-demo.json';
writeFileSync(destino, JSON.stringify(salida, null, 1), 'utf8');
console.log('guardado en', destino);
await pool.end();
