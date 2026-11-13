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

// En local, cada carga del HTML invalida la caché del navegador: evita quedarse
// con un build viejo servido por el service worker.
app.addHook('onSend', async (req, reply, payload) => {
  const host = req.headers.host || '';
  if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) &&
      req.method === 'GET' &&
      (req.url === '/' || req.url.startsWith('/?'))) {
    reply.header('Clear-Site-Data', '"cache"');
  }
  return payload;
});

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
    q(`select id, categoria_id, codigo, descripcion, es_planificada, requiere_comentario, direccion
         from codigos_causa where activo order by categoria_id, descripcion`),
    q(`select t.id, t.fecha, t.nombre, t.supervisor, t.proceso_id, t.cerrado,
              r.nombre as proceso
         from turnos t
         left join recetas r on r.id = t.proceso_id
        where t.id = fn_turno_para(now())`),
    q('select maquina_id, codigo_causa_id from maquina_causas'),
    q('select * from v_receta_etapas')
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
    q(`select lm.linea_id, lm.posicion, lm.rama, lm.detiene_linea, lm.fin_linea, lm.pos_x, lm.pos_y,
              m.id as maquina_id, m.codigo, m.nombre, m.nombre_corto, m.criticidad,
              a.nombre as area
         from linea_maquinas lm
         join maquinas m on m.id = lm.maquina_id
         join areas a on a.id = m.area_id
        order by lm.linea_id, lm.posicion, lm.rama`)
  ]);
  const conexiones = await q('select linea_id, desde_maquina_id, hasta_maquina_id from linea_conexiones');
  return { lineas: lineas.rows, trama: trama.rows, conexiones: conexiones.rows };
});

// ---------------- equipos repetidos en líneas armadas ----------------
// Un equipo físico no puede estar en dos líneas del turno al mismo tiempo.

// Equipos de `maquinaIds` que ya están en OTRA línea armada del turno vigente.
async function equiposEnOtrasLineasArmadas(lineaId, maquinaIds) {
  if (!maquinaIds.length) return [];
  const r = await q(`
    select m.id, m.nombre_corto, l.id as linea_id, l.nombre as linea
      from linea_maquinas lm
      join maquinas m on m.id = lm.maquina_id
      join lineas l on l.id = lm.linea_id
     where lm.maquina_id = any($1::int[])
       and lm.linea_id <> $2
       and lm.linea_id in (
             select e.linea_id
               from receta_etapas e
               join turnos t on t.proceso_id = e.receta_id
              where t.id = fn_turno_para(now()) and e.tipo = 'linea')
     order by m.nombre_corto`, [maquinaIds, lineaId]);
  return r.rows;
}

// Equipos que aparecen en más de una de las líneas dadas.
async function equiposRepetidosEnLineas(lineaIds) {
  if (!lineaIds.length) return [];
  const r = await q(`
    select m.id, m.nombre_corto, array_agg(l.nombre order by l.nombre) as lineas
      from linea_maquinas lm
      join maquinas m on m.id = lm.maquina_id
      join lineas l on l.id = lm.linea_id
     where lm.linea_id = any($1::int[])
     group by m.id, m.nombre_corto
    having count(distinct lm.linea_id) > 1
     order by m.nombre_corto`, [lineaIds]);
  return r.rows;
}

function mensajeEquipoRepetido(choque) {
  const partes = [...new Set(choque.map(c => `${c.nombre_corto} ya está en ${c.linea}`))];
  return 'No se puede sumar el equipo: ' + partes.join('; ') +
    '. Un equipo no puede estar en dos líneas armadas a la vez — detené su proceso en esa línea ' +
    '(o quitá esa línea del turno) antes de pasarlo a otra.';
}

function mensajeTurnoConRepetidos(rep) {
  const partes = rep.slice(0, 5).map(x => `${x.nombre_corto} en ${x.lineas.join(' y ')}`);
  return 'Estas líneas comparten equipos: ' + partes.join('; ') +
    (rep.length > 5 ? ` y ${rep.length - 5} más` : '') +
    '. Un equipo no puede estar en dos líneas armadas al mismo tiempo: detené su proceso en la ' +
    'primera línea o queda una sola de las dos en el turno.';
}

// Mover un equipo de una línea a otra: el equipo cambia de proceso, no se duplica.
app.post('/api/lineas/:id/mover-equipo', async (req, reply) => {
  const desde = Number(req.params.id);
  const b = req.body || {};
  const maq = Number(b.maquina_id);
  const dest = Number(b.destino_id);
  if (!Number.isInteger(desde) || !Number.isInteger(maq) || !Number.isInteger(dest)) {
    return reply.code(400).send({ error: 'faltan datos para mover el equipo' });
  }
  if (dest === desde) return reply.code(400).send({ error: 'es la misma línea' });

  const activa = await q(`select 1 from registro_paradas where maquina_id = $1 and estado = 'activa' limit 1`, [maq]);
  if (activa.rowCount) {
    return reply.code(409).send({ error: 'ese equipo tiene una parada en curso: reanudá la operación antes de moverlo' });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const ya = await client.query('select 1 from linea_maquinas where linea_id = $1 and maquina_id = $2', [dest, maq]);
    if (ya.rowCount) {
      await client.query('rollback');
      return reply.code(409).send({ error: 'el equipo ya está en esa línea' });
    }
    const del = await client.query(
      'delete from linea_maquinas where linea_id = $1 and maquina_id = $2 returning maquina_id', [desde, maq]);
    if (!del.rowCount) {
      await client.query('rollback');
      return reply.code(404).send({ error: 'el equipo no está en esa línea' });
    }
    await client.query(
      `delete from linea_conexiones
        where linea_id = $1 and (desde_maquina_id = $2 or hasta_maquina_id = $2)`, [desde, maq]);
    await client.query(
      `insert into linea_maquinas (linea_id, maquina_id, posicion, rama, detiene_linea, fin_linea)
       values ($1, $2, (select coalesce(max(posicion), 0) + 1 from linea_maquinas where linea_id = $1), 1, false, false)`,
      [dest, maq]);
    await client.query('commit');
    return { ok: true, desde, destino: dest, maquina_id: maq };
  } catch (e) {
    await client.query('rollback');
    return reply.code(400).send({ error: e.message });
  } finally {
    client.release();
  }
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

  // Un equipo que HOY está en otra línea armada del turno no puede sumarse a
  // ésta: el mismo equipo físico no puede correr en dos líneas a la vez. Pero
  // esta línea puede NO estar armada todavía (se arma para el próximo cambio),
  // así que la regla sólo aplica cuando la línea que se edita está en el turno.
  try {
    const armada = await q(`
      select 1 from receta_etapas e
        join turnos t on t.proceso_id = e.receta_id
       where t.id = fn_turno_para(now()) and e.tipo = 'linea' and e.linea_id = $1
       limit 1`, [lineaId]);
    const previas = await q('select maquina_id from linea_maquinas where linea_id = $1', [lineaId]);
    const antes = new Set(previas.rows.map(r => Number(r.maquina_id)));
    const nuevas = [...ids].filter(id => !antes.has(id));
    const choque = armada.rowCount ? await equiposEnOtrasLineasArmadas(lineaId, nuevas) : [];
    if (choque.length) {
      return reply.code(409).send({ error: mensajeEquipoRepetido(choque) });
    }
  } catch (e) {
    return reply.code(400).send({ error: e.message });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    // La tarjeta de Eventualidades es estándar de cada línea: si el editor no la
    // manda, se conserva en su posición (no se pierde al guardar la trama).
    const ever = await client.query(
      `select lm.* from linea_maquinas lm join maquinas m on m.id = lm.maquina_id
        where lm.linea_id = $1 and m.nombre_corto like 'Eventualidades%' limit 1`, [lineaId]);

    await client.query('delete from linea_maquinas where linea_id = $1', [lineaId]);
    for (let i = 0; i < maquinas.length; i++) {
      await client.query(
        `insert into linea_maquinas (linea_id, maquina_id, posicion, rama, detiene_linea, fin_linea, pos_x, pos_y)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [lineaId, maquinas[i].maquina_id,
         maquinas[i].posicion ?? i + 1,
         maquinas[i].rama ?? 1,
         Boolean(maquinas[i].detiene_linea),
         Boolean(maquinas[i].fin_linea),
         maquinas[i].pos_x ?? null,
         maquinas[i].pos_y ?? null]
      );
    }
    if (ever.rowCount && !ids.has(Number(ever.rows[0].maquina_id))) {
      const e = ever.rows[0];
      const ocupado = await client.query(
        `select 1 from linea_maquinas where linea_id = $1 and posicion = $2 and rama = $3`,
        [lineaId, e.posicion, e.rama]);
      if (!ocupado.rowCount) {
        await client.query(
          `insert into linea_maquinas (linea_id, maquina_id, posicion, rama, detiene_linea, fin_linea, pos_x, pos_y)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [lineaId, e.maquina_id, e.posicion, e.rama, e.detiene_linea, e.fin_linea, e.pos_x, e.pos_y]);
      } else {
        await client.query(
          `insert into linea_maquinas (linea_id, maquina_id, posicion, rama, detiene_linea, fin_linea)
           select $1, $2, coalesce(max(posicion), 0) + 1, 1, false, false
             from linea_maquinas where linea_id = $1`,
          [lineaId, e.maquina_id]);
      }
    } else if (!ever.rowCount) {
      // línea nueva: la tarjeta de Eventualidades viene con la línea
      await client.query('select fn_asegurar_eventualidades($1)', [lineaId]);
    }
    // conexiones entre bloques (quién alimenta a quién)
    await client.query('delete from linea_conexiones where linea_id = $1', [lineaId]);
    for (const c of (req.body.conexiones || [])) {
      if (!c.desde_maquina_id || !c.hasta_maquina_id) continue;
      await client.query(
        `insert into linea_conexiones (linea_id, desde_maquina_id, hasta_maquina_id)
         values ($1, $2, $3) on conflict do nothing`,
        [lineaId, c.desde_maquina_id, c.hasta_maquina_id]);
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
        comentarios_operador: e.comentario ?? null,
        linea_id: e.linea_id ?? null
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
  const [areas, maquinas, lineas, trama, conexiones, especies, productos, recetas, distribucion,
         causas, categorias, maquinaCausas, etapas] = await Promise.all([
    q('select id, codigo, nombre, orden, activa from areas order by orden, nombre'),
    q(`select m.id, m.area_id, m.codigo, m.nombre, m.nombre_corto, m.criticidad, m.activa,
              (select count(*) from registro_paradas p where p.maquina_id = m.id)::int as paradas
         from maquinas m order by m.area_id, m.orden, m.codigo`),
    q(`select l.id, l.codigo, l.nombre, l.descripcion, l.orden, l.activa,
              l.especie_id, l.producto_id, e.nombre as especie, p.nombre as producto
         from lineas l
         left join especies e on e.id = l.especie_id
         left join productos p on p.id = l.producto_id
        order by l.orden, l.codigo`),
    q(`select linea_id, maquina_id, posicion, rama, detiene_linea, fin_linea, pos_x, pos_y
         from linea_maquinas order by linea_id, posicion, rama`),
    q('select linea_id, desde_maquina_id, hasta_maquina_id from linea_conexiones'),
    q('select id, codigo, nombre, activa from especies order by nombre'),
    q('select id, codigo, nombre, especie_id, activo from productos order by nombre'),
    q('select * from v_recetas'),
    q('select receta_id, maquina_id, porcentaje from receta_maquinas'),
    q('select id, codigo, categoria_id, descripcion, es_planificada, activo, direccion from codigos_causa order by categoria_id, descripcion'),
    q('select id, codigo, nombre, icono, orden from categorias_falla where activa order by orden'),
    q('select maquina_id, codigo_causa_id from maquina_causas'),
    q('select * from v_receta_etapas')
  ]);
  return {
    areas: areas.rows, maquinas: maquinas.rows, lineas: lineas.rows, trama: trama.rows,
    especies: especies.rows, productos: productos.rows,
    recetas: recetas.rows, distribucion: distribucion.rows,
    causas: causas.rows, categorias: categorias.rows, maquina_causas: maquinaCausas.rows,
    etapas: etapas.rows, conexiones: conexiones.rows
  };
});

const texto = (v, max = 120) => (v == null ? null : String(v).trim().slice(0, max));
const codigo = (v) => texto(v, 24)?.toUpperCase();

// El código es interno: si no lo escriben, se arma desde el nombre.
const slug = (t) => String(t || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  .slice(0, 18) || 'EQ';

async function nombreMaquinaUnico(client, areaId, base) {
  const limpio = texto(base, 80) || 'EQUIPO';
  const libre = async (n) => !(await client.query(
    'select 1 from maquinas where area_id = $1 and lower(nombre) = lower($2)', [areaId, n])).rowCount;
  if (await libre(limpio)) return limpio;
  // si el nombre ya trae número, se sigue la serie (LINEA 1 → LINEA 2); si no, 2, 3…
  const m = /^(.*?)[\s-]*(\d+)$/.exec(limpio);
  const raiz = m ? m[1].trim() : limpio.replace(/\s*\(copia\)\s*$/i, '').trim();
  let k = m ? Number(m[2]) + 1 : 2;
  while (k < 500) {
    const cand = `${raiz} ${k}`;
    if (await libre(cand)) return cand;
    k += 1;
  }
  return `${raiz} ${Date.now().toString().slice(-4)}`;
}

// Mismo criterio para el nombre corto: dos equipos del área no pueden llamarse igual.
async function cortoMaquinaUnico(client, areaId, base) {
  const limpio = texto(base, 40) || 'EQUIPO';
  const libre = async (n) => !(await client.query(
    'select 1 from maquinas where area_id = $1 and lower(nombre_corto) = lower($2)', [areaId, n])).rowCount;
  if (await libre(limpio)) return limpio;
  const m = /^(.*?)[\s-]*(\d+)$/.exec(limpio);
  const raiz = m ? m[1].trim() : limpio;
  let k = m ? Number(m[2]) + 1 : 2;
  while (k < 500) {
    const cand = `${raiz} ${k}`;
    if (await libre(cand)) return cand;
    k += 1;
  }
  return `${raiz} ${Date.now().toString().slice(-4)}`;
}

// 23505 puede ser el código o el nombre dentro del área: hay que distinguirlos.
function mensajeMaquina(e) {
  if (e.code !== '23505') return e.message;
  if ((e.constraint || '').includes('codigo')) return 'Ya existe un equipo con ese código.';
  return 'Ya existe un equipo con ese nombre en el área. Cambiá el nombre.';
}

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

// Copiar una línea con su configuración: trama y, opcionalmente, equipos y recetas.
app.post('/api/lineas/:id/copiar', async (req, reply) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const duplicar = b.duplicar_equipos !== false;
  const copiarRecetas = b.copiar_recetas !== false;
  const sufijo = texto(b.sufijo, 24) || ' (copia)';

  const client = await pool.connect();
  try {
    await client.query('begin');
    const orig = await client.query('select * from lineas where id = $1', [id]);
    if (!orig.rowCount) {
      await client.query('rollback');
      return reply.code(404).send({ error: 'línea no existe' });
    }
    const L = orig.rows[0];
    const nombre = texto(b.nombre, 80) || `${L.nombre}${sufijo}`;
    const nuevoCodigo = codigo(b.codigo) || await codigoUnico('lineas', slug(nombre));

    const nueva = await client.query(
      `insert into lineas (codigo, nombre, descripcion, orden, especie_id, producto_id)
       values ($1, $2, $3, (select coalesce(max(orden), 0) + 1 from lineas), $4, $5)
       returning *`,
      [nuevoCodigo, nombre, L.descripcion, L.especie_id, L.producto_id]);
    const lineaId = nueva.rows[0].id;

    const trama = await client.query(
      'select * from linea_maquinas where linea_id = $1 order by posicion', [id]);
    const mapa = new Map();

    for (const t of trama.rows) {
      let maquinaId = t.maquina_id;
      if (duplicar) {
        const m = await client.query('select * from maquinas where id = $1', [t.maquina_id]);
        const M = m.rows[0];
        const nombreNuevo = await nombreMaquinaUnico(client, M.area_id, `${M.nombre}${sufijo}`);
        const cortoNuevo = await cortoMaquinaUnico(client, M.area_id, `${M.nombre_corto}${sufijo}`);
        const cod = await codigoUnico('maquinas', slug(cortoNuevo));
        const nm = await client.query(
          `insert into maquinas (area_id, codigo, nombre, nombre_corto, criticidad, orden, activa)
           values ($1, $2, $3, $4, $5,
                   (select coalesce(max(orden), 0) + 1 from maquinas where area_id = $1), true)
           returning id`,
          [M.area_id, cod, nombreNuevo, cortoNuevo, M.criticidad]);
        maquinaId = nm.rows[0].id;
        await client.query(
          `insert into maquina_causas (maquina_id, codigo_causa_id)
           select $1, codigo_causa_id from maquina_causas where maquina_id = $2`,
          [maquinaId, t.maquina_id]);
      }
      mapa.set(t.maquina_id, maquinaId);
      await client.query(
        `insert into linea_maquinas (linea_id, maquina_id, posicion, rama, detiene_linea, fin_linea, pos_x, pos_y)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [lineaId, maquinaId, t.posicion, t.rama || 1, t.detiene_linea, t.fin_linea, t.pos_x, t.pos_y]);
    }

    // las conexiones se copian apuntando a los equipos nuevos
    const cons = await client.query(
      'select desde_maquina_id, hasta_maquina_id from linea_conexiones where linea_id = $1', [id]);
    for (const c of cons.rows) {
      const desde = mapa.get(c.desde_maquina_id);
      const hasta = mapa.get(c.hasta_maquina_id);
      if (!desde || !hasta) continue;
      await client.query(
        `insert into linea_conexiones (linea_id, desde_maquina_id, hasta_maquina_id)
         values ($1, $2, $3) on conflict do nothing`, [lineaId, desde, hasta]);
    }

    let recetas = 0;
    if (copiarRecetas) {
      const rs = await client.query('select * from recetas where linea_id = $1', [id]);
      for (const r of rs.rows) {
        const codR = await codigoUnico('recetas', slug(`${r.codigo}-C`));
        const nr = await client.query(
          `insert into recetas (codigo, nombre, especie_id, producto_id, linea_id,
                                toneladas_turno, rendimiento_pct, vigente_desde, vigente_hasta, activa, notas)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
          [codR, `${r.nombre}${sufijo}`, r.especie_id, r.producto_id, lineaId,
           r.toneladas_turno, r.rendimiento_pct, r.vigente_desde, r.vigente_hasta, r.activa, r.notas]);

        const dist = await client.query('select * from receta_maquinas where receta_id = $1', [r.id]);
        for (const d of dist.rows) {
          await client.query(
            `insert into receta_maquinas (receta_id, maquina_id, porcentaje) values ($1, $2, $3)`,
            [nr.rows[0].id, mapa.get(d.maquina_id) || d.maquina_id, d.porcentaje]);
        }
        recetas += 1;
      }
    }

    await client.query('commit');
    return { ok: true, linea_id: lineaId, codigo: nuevoCodigo, nombre, maquinas: trama.rowCount, recetas };
  } catch (e) {
    await client.query('rollback');
    return reply.code(400).send({ error: e.code === '23505' ? 'código repetido, probá otro nombre' : e.message });
  } finally {
    client.release();
  }
});

app.post('/api/lineas', async (req, reply) => {
  const b = req.body || {};
  if (!texto(b.nombre)) {
    return reply.code(400).send({ error: 'el nombre es obligatorio' });
  }
  try {
    const code = codigo(b.codigo) || await codigoUnico('lineas', slug(b.nombre));
    const r = await q(
      `insert into lineas (codigo, nombre, descripcion, orden, especie_id, producto_id)
       values ($1, $2, $3, coalesce($4, (select coalesce(max(orden), 0) + 1 from lineas)), $5, $6)
       returning *`,
      [code, texto(b.nombre), texto(b.descripcion, 240), b.orden ?? null,
       b.especie_id ?? null, b.producto_id ?? null]);
    // cada línea nace con su tarjeta de Eventualidades (independiente de las demás)
    await q('select fn_asegurar_eventualidades($1)', [r.rows[0].id]);
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
                         descripcion = coalesce($4, descripcion),
                         activa = coalesce($5, activa),
                         orden = coalesce($6, orden),
                         especie_id = coalesce($7, especie_id),
                         producto_id = coalesce($8, producto_id)
        where id = $1 returning *`,
      [req.params.id, codigo(b.codigo) || null, texto(b.nombre), texto(b.descripcion, 240),
       b.activa ?? null, b.orden ?? null, b.especie_id ?? null, b.producto_id ?? null]);
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

// Eliminar una línea: se borran trama y conexiones; las paradas históricas
// quedan sin línea (la máquina sigue existiendo).
app.delete('/api/lineas/:id', async (req, reply) => {
  const id = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from linea_conexiones where linea_id = $1', [id]);
    await client.query('delete from linea_maquinas where linea_id = $1', [id]);
    const r = await client.query('delete from lineas where id = $1 returning id', [id]);
    await client.query('commit');
    if (!r.rowCount) return reply.code(404).send({ error: 'línea no existe' });
    return { ok: true };
  } catch (e) {
    await client.query('rollback');
    return reply.code(400).send({ error: e.message });
  } finally {
    client.release();
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
    // cada equipo es único: si el nombre ya existe en el área, se numera solo
    const nombre = await nombreMaquinaUnico(client, b.area_id, texto(b.nombre));
    const corto = await cortoMaquinaUnico(client, b.area_id,
      texto(b.nombre_corto, 40) || nombre);
    const code = codigo(b.codigo) || await codigoUnico('maquinas', slug(corto));
    const r = await client.query(
      `insert into maquinas (area_id, codigo, nombre, nombre_corto, criticidad, orden, activa)
       values ($1, $2, $3, $4, coalesce($5, 2),
               coalesce($6, (select coalesce(max(orden), 0) + 1 from maquinas where area_id = $1)),
               coalesce($7, true))
       returning *`,
      [b.area_id, code, nombre, corto,
       b.criticidad ?? 2, b.orden ?? 0, b.activa ?? true]);
    await guardarCausasMaquina(client, r.rows[0].id, b.causas);
    await client.query('commit');
    return { ...r.rows[0], causas: b.causas || [] };
  } catch (e) {
    await client.query('rollback');
    return reply.code(400).send({ error: mensajeMaquina(e) });
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
    return reply.code(400).send({ error: mensajeMaquina(e) });
  } finally {
    client.release();
  }
});

// Copiar un equipo (con sus fallas asignadas) para armar líneas equivalentes.
app.post('/api/maquinas/:id/copiar', async (req, reply) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('begin');
    const o = await client.query('select * from maquinas where id = $1', [id]);
    if (!o.rowCount) {
      await client.query('rollback');
      return reply.code(404).send({ error: 'máquina no existe' });
    }
    const M = o.rows[0];
    const areaDestino = b.area_id ?? M.area_id;
    const base = texto(b.nombre, 80) || `${M.nombre} (copia)`;
    // dentro de un área el nombre es único: si ya existe, se numera solo
    const nombre = await nombreMaquinaUnico(client, areaDestino, base);
    const corto = await cortoMaquinaUnico(client, areaDestino,
      texto(b.nombre_corto, 40) || `${M.nombre_corto} (copia)`);
    const code = codigo(b.codigo) || await codigoUnico('maquinas', slug(nombre));
    const r = await client.query(
      `insert into maquinas (area_id, codigo, nombre, nombre_corto, criticidad, orden, activa)
       values ($1, $2, $3, $4, $5,
               (select coalesce(max(orden), 0) + 1 from maquinas where area_id = $1), $6)
       returning *`,
      [areaDestino, code, nombre, corto, M.criticidad, M.activa]);

    if (b.copiar_fallas !== false) {
      await client.query(
        `insert into maquina_causas (maquina_id, codigo_causa_id)
         select $1, codigo_causa_id from maquina_causas where maquina_id = $2`,
        [r.rows[0].id, id]);
    }
    await client.query('commit');
    return r.rows[0];
  } catch (e) {
    await client.query('rollback');
    return reply.code(400).send({ error: e.code === '23505' ? 'código repetido' : e.message });
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

// Editar una falla del catálogo (descripción, planificada, dirección)
app.put('/api/causas/:id', async (req, reply) => {
  const b = req.body || {};
  try {
    const r = await q(
      `update codigos_causa
          set descripcion = coalesce($2, descripcion),
              es_planificada = coalesce($3, es_planificada),
              direccion = coalesce($4, direccion),
              activo = coalesce($5, activo)
        where id = $1 returning *`,
      [req.params.id, texto(b.descripcion, 120), b.es_planificada ?? null,
       b.direccion ?? null, b.activo ?? null]);
    if (!r.rowCount) return reply.code(404).send({ error: 'falla no existe' });
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.message });
  }
});

// Eliminar una falla del catálogo. Si ya tiene paradas registradas no se borra:
// se desactiva para no romper el historial.
app.delete('/api/causas/:id', async (req, reply) => {
  const id = Number(req.params.id);
  const uso = await q('select count(*)::int n from registro_paradas where codigo_causa_id = $1', [id]);
  if (uso.rows[0].n > 0) {
    await q('update codigos_causa set activo = false where id = $1', [id]);
    return { ok: true, desactivada: true, paradas: uso.rows[0].n };
  }
  try {
    await q('delete from codigos_causa where id = $1', [id]);
    return { ok: true, desactivada: false };
  } catch (e) {
    return reply.code(400).send({ error: e.message });
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

    // opcional: asignarla de una vez a varios equipos (familia)
    if (Array.isArray(b.aplicar_a) && b.aplicar_a.length) {
      for (const mid of b.aplicar_a) {
        await q(`insert into maquina_causas (maquina_id, codigo_causa_id) values ($1, $2)
                 on conflict do nothing`, [mid, r.rows[0].id]);
      }
    }
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.code === '23505' ? 'esa falla ya existe' : e.message });
  }
});

app.post('/api/especies', async (req, reply) => {
  const b = req.body || {};
  if (!texto(b.nombre)) {
    return reply.code(400).send({ error: 'el nombre es obligatorio' });
  }
  try {
    const code = codigo(b.codigo) || await codigoUnico('especies', slug(b.nombre));
    const r = await q('insert into especies (codigo, nombre) values ($1, $2) returning *',
      [code, texto(b.nombre)]);
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.code === '23505' ? 'esa especie ya existe' : e.message });
  }
});

app.post('/api/productos', async (req, reply) => {
  const b = req.body || {};
  if (!texto(b.nombre)) {
    return reply.code(400).send({ error: 'el nombre es obligatorio' });
  }
  try {
    const code = codigo(b.codigo) || await codigoUnico('productos', slug(b.nombre));
    const r = await q('insert into productos (codigo, nombre, especie_id) values ($1, $2, $3) returning *',
      [code, texto(b.nombre), b.especie_id ?? null]);
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
      const cur = await client.query('select * from recetas where id = $1', [recetaId]);
      if (!cur.rowCount) throw new Error('receta no existe');
      const c = cur.rows[0];
      // PUT parcial: lo que no viene en el cuerpo se queda como está. El tablero
      // manda sólo el nombre del armado y no debe borrarle especie, producto,
      // línea ni toneladas, ni quedarse sin código.
      const val = (k) => (b[k] === undefined ? c[k] : b[k]);
      const r = await client.query(
        `update recetas set codigo=$2, nombre=$3, especie_id=$4, producto_id=$5, linea_id=$6,
                            toneladas_turno=$7, rendimiento_pct=$8, vigente_desde=$9,
                            vigente_hasta=$10, activa=$11, notas=$12
          where id=$1 returning id`,
        [recetaId, codigo(val('codigo')) || c.codigo, texto(val('nombre')) || c.nombre,
         val('especie_id') ?? null, val('producto_id') ?? null,
         val('linea_id') ?? null, val('toneladas_turno') ?? null, val('rendimiento_pct') ?? null,
         val('vigente_desde') || null, val('vigente_hasta') || null,
         val('activa') ?? true, texto(val('notas'), 400)]);
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

    // La distribución por máquina sólo se reemplaza si viene en el cuerpo: un
    // PUT que sólo cambia el nombre no puede dejar la receta sin distribución.
    if (b.distribucion !== undefined) {
      await client.query('delete from receta_maquinas where receta_id = $1', [recetaId]);
      for (const d of (b.distribucion || [])) {
        if (!d.maquina_id) continue;
        await client.query(
          `insert into receta_maquinas (receta_id, maquina_id, porcentaje)
           values ($1, $2, $3) on conflict (receta_id, maquina_id) do update set porcentaje = excluded.porcentaje`,
          [recetaId, d.maquina_id, d.porcentaje ?? 100]);
      }
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

// ---------------- etapas del proceso ----------------
app.put('/api/recetas/:id/etapas', async (req, reply) => {
  const id = Number(req.params.id);
  const etapas = (req.body && req.body.etapas) || [];
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from receta_etapas where receta_id = $1', [id]);
    let n = 0;
    const vistos = new Set();   // una línea o máquina no se repite en el proceso
    for (const e of etapas) {
      const tipo = e.tipo === 'linea' ? 'linea' : 'maquina';
      if (tipo === 'linea' && !e.linea_id) continue;
      if (tipo === 'maquina' && !e.maquina_id) continue;
      const clave = tipo + ':' + (tipo === 'linea' ? e.linea_id : e.maquina_id);
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      n += 1;
      await client.query(
        `insert into receta_etapas (receta_id, orden, tipo, maquina_id, linea_id, etiqueta, paralelo)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, e.orden ?? n, tipo,
         tipo === 'maquina' ? e.maquina_id : null,
         tipo === 'linea' ? e.linea_id : null,
         texto(e.etiqueta, 60) || null, Boolean(e.paralelo)]);
    }
    await client.query('commit');
    return { ok: true, etapas: n };
  } catch (err) {
    await client.query('rollback');
    return reply.code(400).send({ error: err.message });
  } finally {
    client.release();
  }
});

// Proceso resuelto: cada etapa con sus máquinas (una línea se expande a su trama).
app.get('/api/recetas/:id/proceso', async (req, reply) => {
  const id = Number(req.params.id);
  const rec = await q('select * from v_recetas where id = $1', [id]);
  if (!rec.rowCount) return reply.code(404).send({ error: 'receta no existe' });

  const [etapas, maquinas, trama] = await Promise.all([
    q('select * from v_receta_etapas where receta_id = $1 order by orden, id', [id]),
    q(`select m.id, m.codigo, m.nombre_corto, m.criticidad, m.area_id, a.nombre as area
         from maquinas m join areas a on a.id = m.area_id where m.activa`),
    q(`select lm.linea_id, lm.maquina_id, lm.posicion, lm.rama, lm.detiene_linea
         from linea_maquinas lm order by lm.linea_id, lm.posicion, lm.rama`)
  ]);

  const porId = new Map(maquinas.rows.map(m => [m.id, m]));
  const etapasResueltas = etapas.rows.map(e => {
    const lista = e.tipo === 'linea'
      ? trama.rows.filter(t => t.linea_id === e.linea_id)
          .map(t => ({ ...porId.get(t.maquina_id), detiene_linea: t.detiene_linea, posicion: t.posicion }))
          .filter(m => m.id)
      : [porId.get(e.maquina_id)].filter(Boolean);
    return { ...e, maquinas: lista };
  });

  return { receta: rec.rows[0], etapas: etapasResueltas };
});

// Monitor del turno: sólo lectura, para la pantalla de planta (sin escrituras)
app.get('/api/monitor', async () => {
  const t = await q(`select t.id, t.fecha, t.nombre, t.supervisor, t.creado_en, t.cerrado, r.nombre as proceso
                       from turnos t left join recetas r on r.id = t.proceso_id
                      where t.id = fn_turno_para(now())`);
  const turno = t.rows[0] || null;
  const ahora = new Date().toISOString();
  if (!turno) return { turno: null, paradas: [], ahora };
  const p = await q(`
    select p.id, p.maquina_id, m.nombre_corto as maquina,
           c.descripcion as causa, c.es_planificada, p.estado,
           p.hora_inicio, p.hora_fin,
           greatest(0, round(extract(epoch from (coalesce(p.hora_fin, now()) - p.hora_inicio)) / 60))::int as minutos
      from registro_paradas p
      join maquinas m on m.id = p.maquina_id
      join codigos_causa c on c.id = p.codigo_causa_id
     where p.turno_id = $1 and p.estado <> 'anulada'
     order by p.hora_inicio desc`, [turno.id]);
  // Cortes de proceso del turno: desde/hasta de cada configuración, con los
  // minutos que estuvo y los minutos perdidos dentro de ese período.
  const c = await q(`
    select c.id, c.desde, c.hasta, c.lineas,
           greatest(0, round(extract(epoch from (coalesce(c.hasta, now()) - c.desde)) / 60))::int as minutos,
           coalesce((
             select round(sum(greatest(0, extract(epoch from (
                        least(coalesce(p.hora_fin, now()), coalesce(c.hasta, now()))
                        - greatest(p.hora_inicio, c.desde)))) / 60))
               from registro_paradas p
              where p.turno_id = c.turno_id and p.estado <> 'anulada'
                and p.hora_inicio < coalesce(c.hasta, now())
           ), 0)::int as perdidos
      from turno_procesos c
     where c.turno_id = $1
     order by c.desde desc`, [turno.id]);
  return { turno, paradas: p.rows, cortes: c.rows, ahora };
});

// Lista de procesos para el operador
app.get('/api/procesos', async () => {
  const r = await q(`select v.id, v.codigo, v.nombre, v.especie, v.producto,
                            v.linea_id, v.linea_codigo,
                            (select count(*) from receta_etapas e where e.receta_id = v.id)::int as etapas
                       from v_recetas v where v.activa order by v.nombre`);
  const etapas = await q(`select receta_id, tipo, linea_id from receta_etapas where tipo = 'linea'`);
  const procesos = r.rows.map(p => {
    const lineas = etapas.rows.filter(e => e.receta_id === p.id).map(e => e.linea_id);
    if (!lineas.length && p.linea_id) lineas.push(p.linea_id);
    return { ...p, lineas: [...new Set(lineas)] };
  });
  return { procesos };
});

// ---------------- análisis de paradas ----------------
// Panel de análisis: resumen, Pareto por causa, por equipo, por línea, por día,
// por turno e historial de paradas con sus acciones (reparación/cambio de equipo).
app.get('/api/analisis', async (req) => {
  const qs = req.query || {};
  const desde = qs.desde ? new Date(qs.desde) : new Date(new Date().setHours(0, 0, 0, 0));
  const hasta = qs.hasta ? new Date(qs.hasta) : new Date();
  const params = [desde.toISOString(), hasta.toISOString()];
  let filtro = '';
  if (qs.linea_id) { params.push(Number(qs.linea_id)); filtro += ` and p.linea_id = $${params.length}`; }
  if (qs.maquina_id) { params.push(Number(qs.maquina_id)); filtro += ` and p.maquina_id = $${params.length}`; }

  const base = `
    from registro_paradas p
    join maquinas m on m.id = p.maquina_id
    join areas a on a.id = m.area_id
    join codigos_causa cc on cc.id = p.codigo_causa_id
    join categorias_falla cg on cg.id = cc.categoria_id
    left join lineas l on l.id = p.linea_id
    left join turnos tu on tu.id = p.turno_id
   where p.estado <> 'anulada'
     and p.hora_inicio >= $1 and p.hora_inicio < $2 ${filtro}`;
  // El Pareto y los totales son de tiempo PERDIDO: las paradas planificadas
  // (fin de turno, lavados) se informan aparte y no ensucian las causas.
  const baseReal = `${base} and not cc.es_planificada`;
  const min = `round(extract(epoch from (coalesce(p.hora_fin, now()) - p.hora_inicio)) / 60)::int`;

  const [resumen, porCausa, porEquipo, porLinea, porDia, porTurno, historial, lineas] = await Promise.all([
    q(`select count(*) filter (where not cc.es_planificada)::int as paradas,
              coalesce(sum(${min}) filter (where not cc.es_planificada), 0)::int as minutos,
              count(*)::int as paradas_total,
              coalesce(sum(${min}), 0)::int as minutos_total,
              count(*) filter (where cc.es_planificada)::int as planificadas,
              coalesce(sum(${min}) filter (where cc.es_planificada), 0)::int as minutos_planificados,
              count(*) filter (where p.estado = 'activa')::int as abiertas,
              count(distinct p.maquina_id)::int as equipos,
              coalesce(max(${min}) filter (where not cc.es_planificada), 0)::int as peor
         ${base}`, params),
    q(`select cc.descripcion as causa, cg.nombre as categoria, cc.es_planificada,
              count(*)::int as paradas, coalesce(sum(${min}), 0)::int as minutos
         ${baseReal}
        group by 1, 2, 3
        order by minutos desc, paradas desc`, params),
    q(`select p.maquina_id, m.nombre_corto as nombre, m.nombre as nombre_largo, a.nombre as area,
              string_agg(distinct l.nombre, ' / ') as lineas,
              count(*)::int as paradas, coalesce(sum(${min}), 0)::int as minutos,
              max(p.hora_inicio) as ultima
         ${baseReal}
        group by p.maquina_id, m.nombre_corto, m.nombre, a.nombre
        order by minutos desc, paradas desc`, params),
    q(`select p.linea_id, coalesce(l.nombre, 'sin línea') as nombre,
              count(*)::int as paradas, coalesce(sum(${min}), 0)::int as minutos
         ${baseReal}
        group by p.linea_id, l.nombre order by minutos desc`, params),
    q(`select to_char(p.hora_inicio at time zone 'America/Punta_Arenas', 'YYYY-MM-DD') as dia,
              count(*)::int as paradas, coalesce(sum(${min}), 0)::int as minutos
         ${baseReal}
        group by 1 order by 1`, params),
    q(`select coalesce(tu.nombre, '—') as turno, count(*)::int as paradas,
              coalesce(sum(${min}), 0)::int as minutos
         ${baseReal}
        group by 1 order by 1`, params),
    q(`select p.id, p.maquina_id, m.nombre_corto as maquina, a.nombre as area,
              l.nombre as linea, cc.descripcion as causa, cg.nombre as categoria,
              cc.es_planificada, p.estado, p.hora_inicio, p.hora_fin,
              ${min} as minutos, p.comentarios_operador as comentario,
              coalesce((
                select json_agg(json_build_object('id', x.id, 'tipo', x.tipo, 'detalle', x.detalle,
                                                  'responsable', x.responsable, 'ocurrido_en', x.ocurrido_en)
                                order by x.ocurrido_en)
                  from parada_acciones x where x.parada_id = p.id
              ), '[]'::json) as acciones
         ${base}
        order by p.hora_inicio desc
        limit 400`, params),
    q('select id, nombre from lineas order by orden, nombre')
  ]);

  const total = resumen.rows[0].minutos || 0;
  let acum = 0;
  const pareto = porCausa.rows.map(r => {
    const pct = total ? Math.round((r.minutos / total) * 100) : 0;
    acum += pct;
    return { ...r, pct, acum: Math.min(100, acum) };
  });

  return {
    rango: { desde: desde.toISOString(), hasta: hasta.toISOString(),
             linea_id: qs.linea_id ? Number(qs.linea_id) : null,
             maquina_id: qs.maquina_id ? Number(qs.maquina_id) : null },
    resumen: resumen.rows[0],
    porCausa: pareto,
    porEquipo: porEquipo.rows,
    porLinea: porLinea.rows,
    porDia: porDia.rows,
    porTurno: porTurno.rows,
    historial: historial.rows,
    lineas: lineas.rows
  };
});

// Anotar una acción sobre una parada (reparación, cambio de equipo, ajuste…)
app.post('/api/paradas/:id/acciones', async (req, reply) => {
  const b = req.body || {};
  const paradaId = Number(req.params.id);
  const tipos = ['reparacion', 'cambio_equipo', 'ajuste', 'otro'];
  if (!Number.isInteger(paradaId)) return reply.code(400).send({ error: 'parada inválida' });
  const tipo = tipos.includes(b.tipo) ? b.tipo : 'reparacion';
  if (!texto(b.detalle)) return reply.code(400).send({ error: 'contá qué se hizo' });
  try {
    const r = await q(
      `insert into parada_acciones (parada_id, tipo, detalle, responsable)
       values ($1, $2, $3, $4) returning *`,
      [paradaId, tipo, texto(b.detalle, 500), texto(b.responsable, 80)]);
    return r.rows[0];
  } catch (e) {
    return reply.code(400).send({ error: e.message });
  }
});

// Lista de acciones de una parada (se usa desde el historial)
app.get('/api/paradas/:id/acciones', async (req) => {
  const r = await q('select * from parada_acciones where parada_id = $1 order by ocurrido_en desc',
    [Number(req.params.id)]);
  return { acciones: r.rows };
});

// Cerrar el turno (fin de turno): detiene las líneas armadas con la causa
// «Fin de turno», cierra el corte de proceso abierto y marca el turno cerrado.
app.post('/api/turnos/cerrar', async (req, reply) => {
  const b = req.body || {};
  try {
    const r = await q('select fn_cerrar_turno(fn_turno_para(now()), $1) as r', [b.usuario ?? null]);
    return r.rows[0].r;
  } catch (e) {
    return reply.code(400).send({ error: e.message });
  }
});

// Proceso vigente del turno
app.patch('/api/turnos/:id/proceso', async (req, reply) => {
  const b = req.body || {};
  try {
    // Regla: un equipo no puede estar en dos líneas armadas al mismo tiempo.
    if (b.proceso_id) {
      const et = await q(`select linea_id from receta_etapas where receta_id = $1 and tipo = 'linea'`,
        [b.proceso_id]);
      const rep = await equiposRepetidosEnLineas(et.rows.map(x => x.linea_id));
      if (rep.length) return reply.code(409).send({ error: mensajeTurnoConRepetidos(rep) });
    }
    const r = await q('update turnos set proceso_id = $2 where id = $1 returning id, proceso_id',
      [req.params.id, b.proceso_id ?? null]);
    if (!r.rowCount) return reply.code(404).send({ error: 'turno no existe' });
    // corte de proceso: cierra el período anterior y abre el nuevo con su foto
    await q('select fn_registrar_proceso_turno($1, $2, $3)',
      [req.params.id, b.proceso_id ?? null, b.usuario ?? null]);
    return r.rows[0];
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
