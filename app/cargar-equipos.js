// Carga los equipos de la planta con sus fallas típicas (idempotente).
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

// Fallas nuevas por categoría (las que no existan se crean)
const NUEVAS = {
  'Mecánica': [
    'Cuchillas desafiladas',
    'Guías desalineadas',
    'Tambor de piel desgastado',
    'Placa del separador gastada',
    'Cadena floja o rota',
    'Fuga de aceite en reductor'
  ],
  'Eléctrica': [
    'Encoder fuera de posición',
    'Guardamotor disparado',
    'Resistencia de sellado en falla',
    'Termocupla descalibrada'
  ],
  'Servicios Básicos': [
    'Vacío insuficiente',
    'Falta de agua de enfriamiento',
    'Temperatura de tambor fuera de rango'
  ],
  'Operativa': ['Atasco de producto', 'Cambio de molde', 'Ajuste por cambio de talla'],
  'Logística': ['Falta de film', 'Falta de cajones']
};

const EQUIPOS = [
  {
    nombre: 'TRIO FDS', corto: 'TRIO', area: 'Zona Primaria', crit: 1,
    causas: ['Tambor de piel desgastado', 'Temperatura de tambor fuera de rango',
             'Falta de agua de enfriamiento', 'Guías desalineadas', 'Atasco de producto',
             'Variador en falla']
  },
  {
    nombre: 'BAADER 176', corto: 'Baader 176', area: 'Zona Primaria', crit: 1,
    causas: ['Cuchillas desafiladas', 'Guías desalineadas', 'Encoder fuera de posición',
             'Correa cortada', 'Falla de rodamiento', 'Variador en falla', 'Atasco de producto',
             'Ajuste por cambio de talla']
  },
  {
    nombre: 'BAADER 212', corto: 'Baader 212', area: 'Zona Primaria', crit: 1,
    causas: ['Cuchillas desafiladas', 'Guías desalineadas', 'Encoder fuera de posición',
             'Falla de rodamiento', 'Variador en falla', 'Falla de contacto', 'Atasco de producto']
  },
  {
    nombre: 'BAADER 601', corto: 'Baader 601', area: 'Zona Secundaria', crit: 2,
    causas: ['Placa del separador gastada', 'Falla de rodamiento', 'Correa cortada',
             'Motor quemado', 'Atasco de producto']
  },
  {
    nombre: 'MULTIVAC R-225', corto: 'Multivac R225', area: 'Empaque', crit: 2,
    causas: ['Vacío insuficiente', 'Resistencia de sellado en falla', 'Termocupla descalibrada',
             'Falla de aire comprimido', 'Falta de film', 'Cambio de molde', 'Sensor desalineado']
  },
  {
    nombre: 'MULTIVAC R530', corto: 'Multivac R530', area: 'Empaque', crit: 2,
    causas: ['Vacío insuficiente', 'Resistencia de sellado en falla', 'Termocupla descalibrada',
             'Falla de aire comprimido', 'Falta de film', 'Cambio de molde', 'Variador en falla']
  },
  {
    nombre: 'BORNCUT 225S', corto: 'Borncut 225S', area: 'Zona Secundaria', crit: 2,
    causas: ['Cuchillas desafiladas', 'Cadena floja o rota', 'Atasco de producto',
             'Ajuste por cambio de talla', 'Falla de aire comprimido']
  }
];

(async () => {
  let s = await get('/api/settings');
  const catId = Object.fromEntries(s.categorias.map(c => [c.nombre, c.id]));
  const areaId = Object.fromEntries(s.areas.map(a => [a.nombre, a.id]));

  // 1. fallas nuevas
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

  // 2. equipos
  let nuevos = 0;
  for (const e of EQUIPOS) {
    const area = areaId[e.area];
    if (!area) { console.log('  ! área no existe:', e.area); continue; }
    let m = s.maquinas.find(x => x.nombre.toLowerCase() === e.nombre.toLowerCase());
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
    if (r2.status !== 200) console.log('  ! asignar', e.nombre, r2.status, r2.body.error);
    else console.log('    fallas asignadas:', ids.length);
  }

  console.log(`\nresumen: ${nuevos} equipos nuevos, ${creadas} fallas nuevas`);
})();
