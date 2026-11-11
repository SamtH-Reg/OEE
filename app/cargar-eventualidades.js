// Equipo de eventualidades: un bloque donde se registran cortes y desabastecimiento.
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

(async () => {
  const s = await get('/api/settings');
  const area = s.areas.find(a => a.nombre === 'Servicios de Planta')
    || (await post('/api/areas', { nombre: 'Servicios de Planta', orden: 3 })).body;

  const cat = Object.fromEntries(s.categorias.map(c => [c.nombre, c.id]));
  const faltantes = [
    { desc: 'Desabastecimiento de materia prima', cat: 'Logística' },
    { desc: 'Eventualidad externa', cat: 'Servicios Básicos' },
    { desc: 'Corte de vapor', cat: 'Servicios Básicos' }
  ];
  const existentes = new Set(s.causas.map(c => c.descripcion));
  for (const f of faltantes) {
    if (existentes.has(f.desc)) continue;
    const r = await post('/api/causas', { categoria_id: cat[f.cat], descripcion: f.desc });
    console.log(r.status === 200 ? '  + falla: ' + f.desc : '  ! ' + f.desc + ' ' + r.body.error);
  }

  const fresco = await get('/api/settings');
  let m = fresco.maquinas.find(x => x.nombre === 'EVENTUALIDADES DE PLANTA');
  if (!m) {
    const r = await post('/api/maquinas', {
      area_id: area.id, nombre: 'EVENTUALIDADES DE PLANTA',
      nombre_corto: 'Eventualidades', criticidad: 1
    });
    if (r.status !== 200) { console.log('! equipo', r.body.error); return; }
    m = r.body;
    console.log('  + equipo:', m.codigo);
  }

  // todas las causas de servicios básicos y logística + las nuevas
  const causas = fresco.causas.filter(c =>
    c.categoria_id === cat['Servicios Básicos'] ||
    c.categoria_id === cat['Logística'] ||
    c.descripcion === 'Desabastecimiento de materia prima');
  const r = await put('/api/maquinas/' + m.id, { causas: causas.map(c => c.id) });
  console.log(r.status === 200
    ? `  fallas asignadas: ${causas.length} (servicios + logística)`
    : '  ! ' + r.body.error);
  console.log('  incluye:', causas.map(c => c.descripcion).join(' · '));
})();
