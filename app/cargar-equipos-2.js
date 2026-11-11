// Carga equipos nuevos con sus fallas típicas (idempotente).
const BASE = 'http://localhost:8787';
const H = { 'content-type': 'application/json', 'x-app-token': 'demo' };

const get = async (p) => (await fetch(BASE + p, { headers: H })).json();
const post = async (p, b) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: H, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
};
const put = async (p, b) => {
  const r = await fetch(BASE + p, { method: 'PUT', headers: H, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
};

const NUEVAS = {
  'Mecánica': [
    'Escarcha en el evaporador',
    'Ventilador del evaporador en falla',
    'Banda desalineada',
    'Banda de alimentación trabada',
    'Compuerta de loteadora trabada'
  ],
  'Eléctrica': [
    'Falla de resistencia de deshielo',
    'Termostato de fin de deshielo',
    'Celda de carga descalibrada'
  ],
  'Servicios Básicos': [
    'Fuga de refrigerante',
    'Temperatura fuera de rango',
    'Drenaje de deshielo tapado'
  ],
  'Operativa': ['Ajuste de peso / receta'],
  'Logística': ['Falta de etiquetas']
};

const EQUIPOS = [
  {
    nombre: 'TUNEL CONTINUO IQF', corto: 'Túnel IQF', area: 'Túnel Continuo IQF', crit: 1,
    causas: ['Escarcha en el evaporador', 'Ventilador del evaporador en falla', 'Banda desalineada',
             'Falla de resistencia de deshielo', 'Termostato de fin de deshielo',
             'Fuga de refrigerante', 'Temperatura fuera de rango', 'Drenaje de deshielo tapado']
  },
  {
    nombre: 'HARDENING TUNNEL', corto: 'Hardening', area: 'Túnel Continuo IQF', crit: 1,
    causas: ['Escarcha en el evaporador', 'Ventilador del evaporador en falla', 'Banda desalineada',
             'Banda de alimentación trabada', 'Falla de resistencia de deshielo',
             'Fuga de refrigerante', 'Temperatura fuera de rango', 'Drenaje de deshielo tapado']
  },
  {
    nombre: 'LINEA FOOD SERVICE', corto: 'Food Service', area: 'Empaque', crit: 2,
    causas: ['Banda de alimentación trabada', 'Atasco de producto', 'Ajuste de peso / receta',
             'Falta de etiquetas', 'Resistencia de sellado en falla', 'Termocupla descalibrada',
             'Sensor desalineado']
  },
  {
    nombre: 'LOTEADORA TARGET BATCHER', corto: 'Target Batcher', area: 'Empaque', crit: 2,
    causas: ['Celda de carga descalibrada', 'Compuerta de loteadora trabada',
             'Ajuste de peso / receta', 'Atasco de producto', 'Falla de aire comprimido']
  }
];

(async () => {
  let s = await get('/api/settings');
  const catId = Object.fromEntries(s.categorias.map(c => [c.nombre, c.id]));
  const areaId = Object.fromEntries(s.areas.map(a => [a.nombre, a.id]));

  const mapaCausas = Object.fromEntries(s.causas.map(c => [c.descripcion, c.id]));
  let creadas = 0;
  for (const [categoria, lista] of Object.entries(NUEVAS)) {
    for (const desc of lista) {
      if (mapaCausas[desc]) continue;
      const r = await post('/api/causas', { categoria_id: catId[categoria], descripcion: desc });
      if (r.status === 200) { mapaCausas[desc] = r.body.id; creadas += 1; }
      else console.log('  ! causa', desc, r.status, r.body.error);
    }
  }

  const actual = await get('/api/settings');
  let nuevos = 0;
  for (const e of EQUIPOS) {
    const area = areaId[e.area];
    if (!area) { console.log('  ! área no existe:', e.area); continue; }
    let m = actual.maquinas.find(x => x.nombre.toLowerCase() === e.nombre.toLowerCase());
    if (!m) {
      const r = await post('/api/maquinas', {
        area_id: area, nombre: e.nombre, nombre_corto: e.corto, criticidad: e.crit
      });
      if (r.status !== 200) { console.log('  ! equipo', e.nombre, r.status, r.body.error); continue; }
      m = r.body;
      nuevos += 1;
      console.log('  +', e.nombre, '->', m.codigo);
    }
    const ids = e.causas.map(d => mapaCausas[d]).filter(Boolean);
    const faltan = e.causas.filter(d => !mapaCausas[d]);
    if (faltan.length) console.log('  ! sin causa:', faltan.join(', '));
    const r2 = await put('/api/maquinas/' + m.id, { causas: ids });
    console.log(r2.status === 200 ? `    fallas asignadas: ${ids.length}` : '    ! ' + r2.body.error);
  }

  console.log(`\nresumen: ${nuevos} equipos nuevos, ${creadas} fallas nuevas`);
})();
