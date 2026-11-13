// Simulación de 30 días de paradas para probar el panel de análisis.
// Todo queda marcado con origen='importado' y comentario 'SIMULACIÓN' para poder
// borrarlo después sin tocar los registros reales.
const fs = require('fs');
const { Client } = require('pg');
const url = fs.readFileSync('C:/Users/jhuequen/Documents/paradas-planta/app/.env', 'utf8')
  .split('DATABASE_URL=')[1].split('\n')[0].trim();

const MARCA = 'SIMULACIÓN';
const DIAS = 30;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20261113);
const al = (arr, pesos) => {
  const total = pesos.reduce((s, p) => s + p, 0);
  let x = R() * total;
  for (let i = 0; i < arr.length; i++) { x -= pesos[i]; if (x <= 0) return arr[i]; }
  return arr[arr.length - 1];
};

// peso por nombre de causa (para que el Pareto tenga forma realista)
function pesoCausa(d) {
  const t = (d || '').toLowerCase();
  if (t.includes('cinta trabada')) return 14;
  if (t.includes('atasco') || t.includes('acumul')) return 11;
  if (t.includes('contacto')) return 9;
  if (t.includes('guardamotor')) return 8;
  if (t.includes('sensor')) return 7;
  if (t.includes('bomba')) return 6;
  if (t.includes('falta de materia') || t.includes('desabastec')) return 7;
  if (t.includes('variador')) return 5;
  if (t.includes('cuchilla') || t.includes('matriz')) return 5;
  if (t.includes('vapor') || t.includes('aire')) return 4;
  if (t.includes('corte de luz')) return 3;
  if (t.includes('personal') || t.includes('dotación')) return 3;
  return 2;
}

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    // limpiar simulaciones anteriores
    const del = await c.query(
      `delete from registro_paradas where origen = 'importado' and comentarios_operador = $1`, [MARCA]);
    console.log('simulaciones anteriores borradas:', del.rowCount);

    const lineas = (await c.query(`
      select l.id, l.nombre,
             array_agg(lm.maquina_id order by lm.posicion) as maquinas
        from lineas l join linea_maquinas lm on lm.linea_id = l.id
       group by l.id, l.nombre order by l.id`)).rows;
    const causas = (await c.query(
      `select id, descripcion, es_planificada from codigos_causa where activo order by id`)).rows;
    const reales = causas.filter(x => !x.es_planificada);
    const planeadas = causas.filter(x => x.es_planificada);
    const pesosCausa = reales.map(x => pesoCausa(x.descripcion));

    const pesoLinea = { 18: 40, 24: 24, 26: 20, 25: 10, 32: 6 };
    const ultimoFin = new Map();   // maquina_id -> timestamp

    const insertar = async (maquina, causa, linea, ini, fin, estado) => {
      await c.query('select fn_asegurar_turno($1)', [ini]);
      const alcance = linea && linea.id === 25 ? 'linea' : 'aguas_abajo';
      await c.query(`
        insert into registro_paradas (uuid_cliente, maquina_id, codigo_causa_id, turno_id, hora_inicio, hora_fin,
                                      impacto, estado, origen, linea_id, alcance, comentarios_operador,
                                      registrado_en, sincronizado_en)
        values (gen_random_uuid(), $1, $2, fn_turno_para($3), $3, $4, 'Total', $5, 'importado', $6, $7, $8, $3, now())`,
        [maquina, causa, ini, fin, estado, linea ? linea.id : null, alcance, MARCA]);
    };

    const hoy = new Date();
    let total = 0;
    for (let d = DIAS - 1; d >= 0; d--) {
      const base = new Date(hoy);
      base.setDate(base.getDate() - d);

      for (const linea of lineas) {
        const peso = pesoLinea[linea.id] || 5;
        const paradasDia = 1 + Math.floor(R() * (linea.id === 18 ? 3 : 2));
        for (let k = 0; k < paradasDia; k++) {
          if (R() * 100 > peso) continue;              // líneas menos activas fallan menos
          const maquina = al(linea.maquinas, linea.maquinas.map(() => 1 + R() * 3));
          const turnoNoche = R() < 0.3;
          const h = turnoNoche ? 20 + Math.floor(R() * 10) : 8 + Math.floor(R() * 11);
          const ini = new Date(base);
          ini.setHours(h % 24, Math.floor(R() * 60), 0, 0);
          if (d === 0 && ini > hoy) continue;

          // duración: la mayoría cortas, algunas largas
          const r = R();
          const dur = r < 0.5 ? 5 + Math.floor(R() * 12)
            : r < 0.8 ? 15 + Math.floor(R() * 30)
            : r < 0.95 ? 45 + Math.floor(R() * 75)
            : 120 + Math.floor(R() * 130);
          const fin = new Date(ini.getTime() + dur * 60000);

          const previo = ultimoFin.get(maquina) || 0;
          if (ini.getTime() < previo + 5 * 60000) continue;   // sin solaparse en el mismo equipo
          ultimoFin.set(maquina, fin.getTime());

          const causa = al(reales, pesosCausa);
          const abierta = d === 0 && R() < 0.15;
          await insertar(maquina,
            causa.id,
            linea,
            ini.toISOString(),
            abierta ? null : fin.toISOString(),
            abierta ? 'activa' : 'cerrada');
          total += 1;
        }

        // parada planificada de fin de turno (solo en la mitad de los días)
        if (planeadas.length && R() < 0.5) {
          const ini = new Date(base);
          ini.setHours(19, 40 + Math.floor(R() * 15), 0, 0);
          if (d > 0) {
            const fin = new Date(ini.getTime() + (30 + Math.floor(R() * 40)) * 60000);
            await insertar(linea.maquinas[0], planeadas[0].id, linea, ini.toISOString(), fin.toISOString(), 'cerrada');
            total += 1;
          }
        }
      }
    }

    const n = (await c.query(
      `select count(*) n, count(*) filter (where estado='activa') abiertas,
              sum(round(extract(epoch from (coalesce(hora_fin, now()) - hora_inicio))/60))::int minutos
         from registro_paradas where origen='importado' and comentarios_operador=$1`, [MARCA])).rows[0];
    console.log('insertadas:', total, '| en base:', JSON.stringify(n));
    console.log('reales intactas:',
      (await c.query("select count(*) n from registro_paradas where origen <> 'importado'")).rows[0].n);
  } finally {
    await c.end();
  }
})();
