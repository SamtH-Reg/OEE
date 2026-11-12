// Agrega "Cambio de matriz" y "Cambio de proceso" a las Multivac.
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
  let s = await get('/api/settings');
  const op = s.categorias.find(c => c.nombre === 'Operativa').id;

  for (const desc of ['Cambio de matriz', 'Cambio de proceso']) {
    if (s.causas.some(c => c.descripcion.toLowerCase() === desc.toLowerCase())) {
      console.log('  = ya existe:', desc);
      continue;
    }
    const r = await post('/api/causas', { categoria_id: op, descripcion: desc, es_planificada: true });
    console.log(r.status === 200 ? '  + falla: ' + desc : '  ! ' + r.body.error);
  }

  s = await get('/api/settings');
  const ids = ['Cambio de matriz', 'Cambio de proceso']
    .map(d => s.causas.find(c => c.descripcion.toLowerCase() === d.toLowerCase())?.id)
    .filter(Boolean);

  for (const m of s.maquinas.filter(x => x.nombre.toUpperCase().startsWith('MULTIVAC'))) {
    const actuales = s.maquina_causas.filter(mc => mc.maquina_id === m.id).map(mc => mc.codigo_causa_id);
    const nuevas = [...new Set([...actuales, ...ids])];
    const r = await put('/api/maquinas/' + m.id, { causas: nuevas });
    console.log(r.status === 200
      ? `  ${m.nombre}: ${nuevas.length} fallas`
      : '  ! ' + m.nombre + ' ' + r.body.error);
  }
})();
