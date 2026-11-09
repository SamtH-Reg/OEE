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
  const [areas, maquinas, categorias, causas, turno] = await Promise.all([
    q('select id, codigo, nombre from areas where activa order by orden, nombre'),
    q(`select id, area_id, codigo, nombre, nombre_corto, criticidad
         from maquinas where activa order by area_id, orden, nombre`),
    q('select id, codigo, nombre, icono, color from categorias_falla where activa order by orden'),
    q(`select id, categoria_id, codigo, descripcion, es_planificada, requiere_comentario
         from codigos_causa where activo order by categoria_id, descripcion`),
    q(`select t.id, t.fecha, t.nombre, t.supervisor
         from turnos t where t.id = fn_turno_para(now())`)
  ]);
  return {
    areas: areas.rows,
    maquinas: maquinas.rows,
    categorias: categorias.rows,
    causas: causas.rows,
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
