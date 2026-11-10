import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL (cadena de conexión de Neon).');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
  max: 5
});

const app = Fastify({ logger: { level: 'warn' } });

// Identidad mínima de la tablet. En producción: JWT de turno.
const token = process.env.APP_TOKEN || 'demo';
app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/api/') && req.headers['x-app-token'] !== token) {
    return reply.code(401).send({ error: 'token inválido' });
  }
});

const q = (sql, params) => pool.query(sql, params);

// Una tablet que sincroniza es una tablet real: se registra sola la primera vez.
async function asegurarDispositivo(id) {
  if (!id) return;
  await q(`insert into dispositivos (id, nombre, ultima_sincronizacion)
           values ($1, $1, now())
           on conflict (id) do update set ultima_sincronizacion = now()`, [id]);
}

// ---------------- catálogo ----------------
app.get('/api/catalogo', async () => {
  // El turno se asegura en una sentencia aparte: si se llamara dentro del SELECT,
  // la fila recién insertada no sería visible para esa misma sentencia.
  await q('select fn_asegurar_turno(now())');
  const [areas, maquinas, categorias, causas, turno, maquinaCausas] = await Promise.all([
    q('select id, codigo, nombre from areas where activa order by orden, nombre'),
    q(`select id, area_id, codigo, nombre, nombre_corto, criticidad
         from maquinas where activa order by area_id, orden, nombre`),
    q('select id, codigo, nombre, icono, color from categorias_falla where activa order by orden'),
    q(`select id, categoria_id, codigo, descripcion, es_planificada, requiere_comentario
         from codigos_causa where activo order by categoria_id, descripcion`),
    q(`select t.id, t.fecha, t.nombre, t.supervisor
         from turnos t where t.id = fn_turno_para(now())`),
    q('select maquina_id, codigo_causa_id from maquina_causas')
  ]);
  return {
    areas: areas.rows,
    maquinas: maquinas.rows,
    categorias: categorias.rows,
    causas: causas.rows,
    maquina_causas: maquinaCausas.rows,
    turno: turno.rows[0] || null,
    ahora: new Date().toISOString()
  };
});

// ---------------- líneas y tramas ----------------
app.get('/api/lineas', async () => {
  const [lineas, trama] = await Promise.all([
    q('select * from v_linea_estado'),
    q(`select lm.linea_id, lm.posicion, lm.detiene_linea,
              m.id as maquina_id, m.codigo, m.nombre, m.nombre_corto, m.criticidad,
              a.nombre as area
         from linea_maquinas lm
         join maquinas m on m.id = lm.maquina_id
         join areas a on a.id = m.area_id
        order by lm.linea_id, lm.posicion`)
  ]);
  return { lineas: lineas.rows, trama: trama.rows };
});

// Reemplaza la trama completa de una línea (orden + cuello de botella).
app.put('/api/lineas/:id/trama', async (req, reply) => {
  const lineaId = Number(req.params.id);
  const maquinas = (req.body && req.body.maquinas) || [];

  if (!Number.isInteger(lineaId)) return reply.code(400).send({ error: 'línea inválida' });
  if (!Array.isArray(maquinas) || maquinas.length === 0) {
    return reply.code(400).send({ error: 'la trama no puede quedar vacía' });
  }
  if (maquinas.filter(m => m.detiene_linea).length > 1) {
    return reply.code(400).send({ error: 'solo puede haber un cuello de botella por línea' });
  }
  const ids = new Set(maquinas.map(m => Number(m.maquina_id)));
  if (ids.size !== maquinas.length) {
    return reply.code(400).send({ error: 'hay máquinas repetidas en la trama' });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from linea_maquinas where linea_id = $1', [lineaId]);
    for (let i = 0; i < maquinas.length; i++) {
      await client.query(
        `insert into linea_maquinas (linea_id, maquina_id, posicion, detiene_linea)
         values ($1, $2, $3, $4)`,
        [lineaId, maquinas[i].maquina_id, i + 1, Boolean(maquinas[i].detiene_linea)]
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    return reply.code(400).send({ error: e.message });
  } finally {
    client.release();
  }
  return { ok: true, linea_id: lineaId, maquinas: maquinas.length };
});

// ---------------- tablero ----------------
// Devuelve cada máquina con su línea/posición, su parada propia (si es el
// origen) y la parada que la afecta por propagación (si viene de otra máquina).
app.get('/api/tablero', async () => {
  const r = await q(`
    with primaria as (
      select distinct on (maquina_id) maquina_id, linea_id, posicion, detiene_linea
        from linea_maquinas
       order by maquina_id, linea_id
    )
    select m.id, m.codigo, m.nombre, m.nombre_corto, m.area_id,
           a.nombre as area, a.orden as area_orden,
           pr.linea_id, pr.posicion, pr.detiene_linea,
           p.uuid_cliente, p.causa, p.categoria, p.es_planificada,
           p.hora_inicio, p.duracion_minutos, p.impacto, p.alcance,
           af.parada_uuid as af_uuid, af.causa as af_causa,
           (select mm.nombre_corto from maquinas mm where mm.id = af.origen_id) as af_origen,
           af.alcance as af_alcance,
           af.hora_inicio as af_inicio, af.duracion_minutos as af_duracion
      from maquinas m
      join areas a on a.id = m.area_id
      left join primaria pr on pr.maquina_id = m.id
      left join v_paradas p
             on p.maquina_id = m.id and p.estado = 'activa'
      left join lateral (
           select v.* from v_maquinas_afectadas v
            where v.maquina_id = m.id and v.afectada
            order by v.hora_inicio
            limit 1
      ) af on true
     where m.activa
     order by a.orden, pr.posicion nulls last, m.orden`);

  const lineas = await q('select * from v_linea_estado');
  return { maquinas: r.rows, lineas: lineas.rows, ahora: new Date().toISOString() };
});

// ---------------- abrir parada ----------------
app.post('/api/paradas', async (req, reply) => {
  const b = req.body || {};
  if (!b.maquina_id || !b.causa_id) {
    return reply.code(400).send({ error: 'maquina_id y causa_id son obligatorios' });
  }
  try {
    await asegurarDispositivo(b.dispositivo_id);
    await q('select fn_asegurar_turno($1)', [b.hora_inicio || new Date().toISOString()]);
    const r = await q(
      `select * from fn_abrir_parada(
         p_maquina_id      => $1::int,
         p_codigo_causa_id => $2::int,
         p_hora_inicio     => $3::timestamptz,
         p_uuid_cliente    => $4::uuid,
         p_impacto         => $5::text,
         p_pct_afectacion  => $6::numeric,
         p_comentario      => $7::text,
         p_dispositivo_id  => $8::text,
         p_usuario         => $9::text,
         p_linea_id        => $10::int,
         p_alcance         => $11::text)`,
      [b.maquina_id, b.causa_id, b.hora_inicio || new Date().toISOString(), b.uuid,
       b.impacto || 'Total', b.porcentaje_afectacion ?? null, b.comentario ?? null,
       b.dispositivo_id ?? null, b.usuario ?? 'tablet', b.linea_id ?? null, b.alcance ?? null]
    );
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.message });
  }
});

// ---------------- cerrar parada ----------------
app.patch('/api/paradas/:uuid/cerrar', async (req, reply) => {
  const b = req.body || {};
  try {
    const r = await q('select * from fn_cerrar_parada($1::uuid, $2::timestamptz, $3::text, $4::text)',
      [req.params.uuid, b.hora_fin || new Date().toISOString(), b.comentario ?? null, b.usuario ?? 'tablet']);
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.message });
  }
});

// ---------------- sincronización del lote offline ----------------
// El lote llega desordenado y puede traer aperturas y cierres mezclados.
// Se aplican primero las aperturas (fn_sync_lote) y después los cierres.
app.post('/api/sync', async (req, reply) => {
  const eventos = (req.body && req.body.eventos) || [];
  if (!Array.isArray(eventos) || eventos.length === 0) {
    return reply.code(400).send({ error: 'eventos vacío' });
  }
  if (eventos.length > 100) {
    return reply.code(413).send({ error: 'máximo 100 eventos por lote' });
  }

  const aperturas = eventos.filter(e => e.tipo !== 'cerrar');
  const cierres = eventos.filter(e => e.tipo === 'cerrar');
  const resultados = [];

  try {
    await asegurarDispositivo(req.body.dispositivo_id);

    if (aperturas.length) {
      const lote = aperturas.map(e => ({
        uuid_cliente: e.uuid,
        maquina_id: e.maquina_id,
        codigo_causa_id: e.causa_id,
        hora_inicio: e.hora_inicio,
        hora_fin: e.hora_fin ?? null,
        impacto: e.impacto || 'Total',
        porcentaje_afectacion: e.porcentaje_afectacion ?? null,
        comentarios_operador: e.comentario ?? null
      }));
      const r = await q('select * from fn_sync_lote($1::jsonb, $2::text, $3::text)',
        [JSON.stringify(lote), req.body.dispositivo_id ?? null, req.body.usuario ?? 'tablet']);

      const aplicados = new Map(r.rows.map(x => [String(x.uuid_cliente), x.estado]));
      for (const e of aperturas) {
        const estado = aplicados.get(String(e.uuid));
        resultados.push({
          id: e.id,
          uuid: e.uuid,
          ok: Boolean(estado),
          error: estado ? null : 'no aplicado'
        });
      }
    }

    for (const e of cierres) {
      try {
        await q('select * from fn_cerrar_parada($1::uuid, $2::timestamptz, $3::text, $4::text)',
          [e.uuid, e.hora_fin, e.comentario ?? null, req.body.usuario ?? 'tablet']);
        resultados.push({ id: e.id, uuid: e.uuid, ok: true });
      } catch (err) {
        resultados.push({ id: e.id, uuid: e.uuid, ok: false, error: err.message });
      }
    }
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }

  return { resultados, pendientes: eventos.length - resultados.filter(r => r.ok).length };
});

// ---------------- historial ----------------
app.get('/api/historial', async (req) => {
  const { desde, hasta, area, maquina } = req.query || {};
  const r = await q(
    `select * from v_paradas
      where fecha between coalesce($1::date, current_date - 1) and coalesce($2::date, current_date)
        and ($3::int is null or area_id = $3)
        and ($4::int is null or maquina_id = $4)
      order by hora_inicio desc limit 500`,
    [desde ?? null, hasta ?? null, area ?? null, maquina ?? null]);
  return { paradas: r.rows };
});

// ---------------- administración (ajustes) ----------------
app.get('/api/settings', async () => {
  const [areas, maquinas, lineas, trama, especies, productos, recetas, distribucion,
         causas, categorias, maquinaCausas] = await Promise.all([
    q('select id, codigo, nombre, orden, activa from areas order by orden, nombre'),
    q(`select m.id, m.area_id, m.codigo, m.nombre, m.nombre_corto, m.criticidad, m.activa,
              (select count(*) from registro_paradas p where p.maquina_id = m.id)::int as paradas
         from maquinas m order by m.area_id, m.orden, m.codigo`),
    q('select id, codigo, nombre, descripcion, orden, activa from lineas order by orden, codigo'),
    q(`select linea_id, maquina_id, posicion, detiene_linea from linea_maquinas order by linea_id, posicion`),
    q('select id, codigo, nombre, activa from especies order by nombre'),
    q('select id, codigo, nombre, especie_id, activo from productos order by nombre'),
    q('select * from v_recetas'),
    q('select receta_id, maquina_id, porcentaje from receta_maquinas'),
    q('select id, codigo, categoria_id, descripcion, es_planificada, activo from codigos_causa order by categoria_id, descripcion'),
    q('select id, codigo, nombre, icono, orden from categorias_falla where activa order by orden'),
    q('select maquina_id, codigo_causa_id from maquina_causas')
  ]);
  return {
    areas: areas.rows, maquinas: maquinas.rows, lineas: lineas.rows, trama: trama.rows,
    especies: especies.rows, productos: productos.rows,
    recetas: recetas.rows, distribucion: distribucion.rows,
    causas: causas.rows, categorias: categorias.rows, maquina_causas: maquinaCausas.rows
  };
});

const texto = (v, max = 120) => (v == null ? null : String(v).trim().slice(0, max));
const codigo = (v) => texto(v, 24)?.toUpperCase();

// El código es interno: si no lo escriben, se arma desde el nombre.
const slug = (t) => String(t || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  .slice(0, 18) || 'EQ';

async function codigoUnico(tabla, base) {
  let code = base, n = 1;
  while (n < 100) {
    const r = await q(`select 1 from ${tabla} where codigo = $1`, [code]);
    if (!r.rowCount) return code;
    n += 1;
    code = `${base}-${n}`.slice(0, 24);
  }
  return `${base}-${Date.now().toString().slice(-4)}`;
}

app.post('/api/lineas', async (req, reply) => {
  const b = req.body || {};
  if (!texto(b.nombre)) {
    return reply.code(400).send({ error: 'el nombre es obligatorio' });
  }
  try {
    const code = codigo(b.codigo) || await codigoUnico('lineas', slug(b.nombre));
    const r = await q(
      `insert into lineas (codigo, nombre, descripcion, orden)
       values ($1, $2, $3, coalesce($4, (select coalesce(max(orden), 0) + 1 from lineas)))
       returning *`,
      [code, texto(b.nombre), texto(b.descripcion, 240), b.orden ?? null]);
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.code === '23505' ? 'ya existe una línea con ese código' : e.message });
  }
});

app.put('/api/lineas/:id', async (req, reply) => {
  const b = req.body || {};
  try {
    const r = await q(
      `update lineas set codigo = coalesce($2, codigo),
                         nombre = coalesce($3, nombre),
                         descripcion = $4,
                         activa = coalesce($5, activa),
                         orden = coalesce($6, orden)
        where id = $1 returning *`,
      [req.params.id, codigo(b.codigo) || null, texto(b.nombre), texto(b.descripcion, 240),
       b.activa ?? null, b.orden ?? null]);
    if (!r.rowCount) return reply.code(404).send({ error: 'línea no existe' });
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.code === '23505' ? 'código de línea repetido' : e.message });
  }
});

// Las fallas típicas del equipo se guardan junto con la máquina.
async function guardarCausasMaquina(client, maquinaId, causas) {
  await client.query('delete from maquina_causas where maquina_id = $1', [maquinaId]);
  for (const id of (causas || [])) {
    await client.query(
      `insert into maquina_causas (maquina_id, codigo_causa_id) values ($1, $2)
       on conflict do nothing`, [maquinaId, id]);
  }
}

app.post('/api/areas', async (req, reply) => {
  const b = req.body || {};
  if (!texto(b.nombre)) return reply.code(400).send({ error: 'el nombre es obligatorio' });
  try {
    const code = codigo(b.codigo) || await codigoUnico('areas', slug(b.nombre));
    const r = await q(
      `insert into areas (codigo, nombre, orden)
       values ($1, $2, coalesce($3, (select coalesce(max(orden), 0) + 1 from areas)))
       returning *`,
      [code, texto(b.nombre, 80), b.orden ?? null]);
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.code === '23505' ? 'ya existe un área con ese nombre' : e.message });
  }
});

app.put('/api/areas/:id', async (req, reply) => {
  const b = req.body || {};
  try {
    const r = await q(
      `update areas set nombre = coalesce($2, nombre),
                        orden = coalesce($3, orden),
                        activa = coalesce($4, activa)
        where id = $1 returning *`,
      [req.params.id, texto(b.nombre, 80), b.orden ?? null, b.activa ?? null]);
    if (!r.rowCount) return reply.code(404).send({ error: 'área no existe' });
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.code === '23505' ? 'nombre de área repetido' : e.message });
  }
});

app.post('/api/maquinas', async (req, reply) => {
  const b = req.body || {};
  if (!b.area_id || !texto(b.nombre)) {
    return reply.code(400).send({ error: 'área y nombre son obligatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    const code = codigo(b.codigo) || await codigoUnico('maquinas', slug(b.nombre_corto || b.nombre));
    const r = await client.query(
      `insert into maquinas (area_id, codigo, nombre, nombre_corto, criticidad, orden, activa)
       values ($1, $2, $3, $4, coalesce($5, 2),
               coalesce($6, (select coalesce(max(orden), 0) + 1 from maquinas where area_id = $1)),
               coalesce($7, true))
       returning *`,
      [b.area_id, code, texto(b.nombre), texto(b.nombre_corto, 40) || texto(b.nombre, 20),
       b.criticidad ?? 2, b.orden ?? 0, b.activa ?? true]);
    await guardarCausasMaquina(client, r.rows[0].id, b.causas);
    await client.query('commit');
    return { ...r.rows[0], causas: b.causas || [] };
  } catch (e) {
    await client.query('rollback');
    return reply.code(400).send({ error: e.code === '23505' ? 'ya existe una máquina con ese código' : e.message });
  } finally {
    client.release();
  }
});

app.put('/api/maquinas/:id', async (req, reply) => {
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('begin');
    const r = await client.query(
      `update maquinas set area_id = coalesce($2, area_id),
                           codigo = coalesce($3, codigo),
                           nombre = coalesce($4, nombre),
                           nombre_corto = coalesce($5, nombre_corto),
                           criticidad = coalesce($6, criticidad),
                           activa = coalesce($7, activa)
        where id = $1 returning *`,
      [req.params.id, b.area_id ?? null, codigo(b.codigo) || null, texto(b.nombre), texto(b.nombre_corto, 40),
       b.criticidad ?? null, b.activa ?? null]);
    if (!r.rowCount) {
      await client.query('rollback');
      return reply.code(404).send({ error: 'máquina no existe' });
    }
    if (Array.isArray(b.causas)) await guardarCausasMaquina(client, Number(req.params.id), b.causas);
    await client.query('commit');
    return r.rows[0];
  } catch (e) {
    await client.query('rollback');
    return reply.code(400).send({ error: e.code === '23505' ? 'código de máquina repetido' : e.message });
  } finally {
    client.release();
  }
});

// Eliminar equipo: solo si no tiene historial. Si lo tiene, se ofrece desactivar.
app.delete('/api/maquinas/:id', async (req, reply) => {
  const id = Number(req.params.id);
  const cuenta = await q('select count(*)::int n from registro_paradas where maquina_id = $1', [id]);
  if (cuenta.rows[0].n > 0) {
    return reply.code(409).send({
      error: `tiene ${cuenta.rows[0].n} parada(s) registradas`,
      paradas: cuenta.rows[0].n
    });
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from maquina_causas where maquina_id = $1', [id]);
    await client.query('delete from receta_maquinas where maquina_id = $1', [id]);
    await client.query('delete from linea_maquinas where maquina_id = $1', [id]);
    const r = await client.query('delete from maquinas where id = $1 returning id', [id]);
    await client.query('commit');
    if (!r.rowCount) return reply.code(404).send({ error: 'máquina no existe' });
    return { ok: true };
  } catch (e) {
    await client.query('rollback');
    return reply.code(400).send({ error: e.message });
  } finally {
    client.release();
  }
});

// Nueva falla del catálogo (se puede crear desde el equipo).
app.post('/api/causas', async (req, reply) => {
  const b = req.body || {};
  if (!b.categoria_id || !texto(b.descripcion)) {
    return reply.code(400).send({ error: 'categoría y descripción son obligatorias' });
  }
  try {
    const code = codigo(b.codigo) || await codigoUnico('codigos_causa', slug(b.descripcion));
    const r = await q(
      `insert into codigos_causa (codigo, categoria_id, descripcion, es_planificada)
       values ($1, $2, $3, $4) returning *`,
      [code, b.categoria_id, texto(b.descripcion, 120), !!b.es_planificada]);
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.code === '23505' ? 'esa falla ya existe' : e.message });
  }
});

app.post('/api/especies', async (req, reply) => {
  const b = req.body || {};
  if (!codigo(b.codigo) || !texto(b.nombre)) {
    return reply.code(400).send({ error: 'código y nombre son obligatorios' });
  }
  try {
    const r = await q('insert into especies (codigo, nombre) values ($1, $2) returning *',
      [codigo(b.codigo), texto(b.nombre)]);
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.code === '23505' ? 'esa especie ya existe' : e.message });
  }
});

app.post('/api/productos', async (req, reply) => {
  const b = req.body || {};
  if (!codigo(b.codigo) || !texto(b.nombre)) {
    return reply.code(400).send({ error: 'código y nombre son obligatorios' });
  }
  try {
    const r = await q('insert into productos (codigo, nombre, especie_id) values ($1, $2, $3) returning *',
      [codigo(b.codigo), texto(b.nombre), b.especie_id ?? null]);
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.code === '23505' ? 'ese producto ya existe' : e.message });
  }
});

async function guardarReceta(id, b) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    let recetaId = id;
    if (recetaId) {
      const r = await client.query(
        `update recetas set codigo=$2, nombre=$3, especie_id=$4, producto_id=$5, linea_id=$6,
                            toneladas_turno=$7, rendimiento_pct=$8, vigente_desde=$9,
                            vigente_hasta=$10, activa=$11, notas=$12
          where id=$1 returning id`,
        [recetaId, codigo(b.codigo), texto(b.nombre), b.especie_id ?? null, b.producto_id ?? null,
         b.linea_id ?? null, b.toneladas_turno ?? null, b.rendimiento_pct ?? null,
         b.vigente_desde || null, b.vigente_hasta || null, b.activa ?? true, texto(b.notas, 400)]);
      if (!r.rowCount) throw new Error('receta no existe');
    } else {
      const r = await client.query(
        `insert into recetas (codigo, nombre, especie_id, producto_id, linea_id,
                              toneladas_turno, rendimiento_pct, vigente_desde, vigente_hasta, activa, notas)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [codigo(b.codigo), texto(b.nombre), b.especie_id ?? null, b.producto_id ?? null,
         b.linea_id ?? null, b.toneladas_turno ?? null, b.rendimiento_pct ?? null,
         b.vigente_desde || null, b.vigente_hasta || null, b.activa ?? true, texto(b.notas, 400)]);
      recetaId = r.rows[0].id;
    }

    await client.query('delete from receta_maquinas where receta_id = $1', [recetaId]);
    for (const d of (b.distribucion || [])) {
      if (!d.maquina_id) continue;
      await client.query(
        `insert into receta_maquinas (receta_id, maquina_id, porcentaje)
         values ($1, $2, $3) on conflict (receta_id, maquina_id) do update set porcentaje = excluded.porcentaje`,
        [recetaId, d.maquina_id, d.porcentaje ?? 100]);
    }
    await client.query('commit');
    return recetaId;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

app.post('/api/recetas', async (req, reply) => {
  const b = req.body || {};
  if (!texto(b.nombre)) {
    return reply.code(400).send({ error: 'el nombre es obligatorio' });
  }
  try {
    b.codigo = codigo(b.codigo) || await codigoUnico('recetas', slug(b.nombre));
    const id = await guardarReceta(null, b);
    return { id };
  } catch (e) {
    return reply.code(400).send({ error: e.code === '23505' ? 'ya existe una receta con ese código' : e.message });
  }
});

app.put('/api/recetas/:id', async (req, reply) => {
  try {
    await guardarReceta(Number(req.params.id), req.body || {});
    return { ok: true };
  } catch (e) {
    return reply.code(400).send({ error: e.message });
  }
});

// ---------------- datos de demostración ----------------
app.get('/api/demo', async () => {
  const r = await q('select * from v_demo_resumen');
  return r.rows[0] || { maquinas: 0, lineas: 0, recetas: 0, paradas: 0 };
});

app.post('/api/demo/eliminar', async (req, reply) => {
  if ((req.body || {}).confirmar !== true) {
    return reply.code(400).send({ error: 'falta confirmar' });
  }
  try {
    const r = await q('select * from fn_eliminar_demo()');
    return { ok: true, borrado: r.rows[0] };
  } catch (e) {
    return reply.code(400).send({ error: e.message });
  }
});

// ---------------- PWA ----------------
app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'web', 'dist'),
  prefix: '/'
});
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'no existe' });
  return reply.sendFile('index.html');
});

app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => console.log(`API + PWA en http://localhost:${PORT}`))
  .catch(err => { console.error(err); process.exit(1); });
