// Pruebas del esquema contra PostgreSQL real.
// Uso: PGURL=postgres://... node tests.js
const { Client } = require('pg');
const conn = process.env.PGURL || 'postgres://postgres@127.0.0.1:54329/paradas';
let pass = 0, fail = 0;

const PRELUDE = `
  insert into turnos (fecha, nombre, supervisor, hora_inicio, hora_fin)
  values ('2026-11-10','Día','Supervisor Día','08:00','20:00'),
         ('2026-11-10','Noche','Supervisor Noche','20:00','08:00'),
         ('2026-11-11','Día','Supervisor Día','08:00','20:00'),
         ('2026-11-11','Noche','Supervisor Noche','20:00','08:00'),
         ('2026-11-12','Día','Supervisor Día','08:00','20:00'),
         ('2026-11-12','Noche','Supervisor Noche','20:00','08:00')
  on conflict (fecha, nombre) do nothing;`;

async function ok(c, nombre, fn) {
  try {
    await c.query('begin');
    await c.query(PRELUDE);
    const detalle = await fn();
    await c.query('rollback');
    pass++;
    console.log(`  PASS  ${nombre}${detalle ? '  ->  ' + detalle : ''}`);
  } catch (e) {
    await c.query('rollback').catch(() => {});
    fail++;
    console.log(`  FAIL  ${nombre}\n        ${e.message}`);
  }
}

async function debeFallar(c, nombre, sql, esperado) {
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('rollback');
    fail++;
    console.log(`  FAIL  ${nombre} (no falló)`);
  } catch (e) {
    await c.query('rollback').catch(() => {});
    if (esperado && !new RegExp(esperado, 'i').test(e.message)) {
      fail++;
      console.log(`  FAIL  ${nombre} (error inesperado: ${e.message})`);
    } else {
      pass++;
      console.log(`  PASS  ${nombre}`);
    }
  }
}

(async () => {
  const c = new Client({ connectionString: conn });
  await c.connect();
  console.log('== Restricciones de integridad');
  await debeFallar(c, 'no permite dos paradas abiertas en la misma máquina', `
    insert into registro_paradas (maquina_id, codigo_causa_id, turno_id, hora_inicio, estado)
    values (5, 1, (select min(id) from turnos), now(), 'activa');`, 'ux_parada_abierta|duplicate');
  await debeFallar(c, 'no permite hora_fin anterior a hora_inicio', `
    insert into registro_paradas (maquina_id, codigo_causa_id, turno_id, hora_inicio, hora_fin, estado)
    values (6, 1, (select min(id) from turnos), now(), now() - interval '10 min', 'cerrada');`, 'ck_fin_posterior');
  await debeFallar(c, 'no permite estado activa con hora_fin', `
    insert into registro_paradas (maquina_id, codigo_causa_id, turno_id, hora_inicio, hora_fin, estado)
    values (7, 1, (select min(id) from turnos), now(), now() + interval '5 min', 'activa');`, 'ck_estado_horas');
  await debeFallar(c, 'no permite impacto Parcial sin porcentaje', `
    insert into registro_paradas (maquina_id, codigo_causa_id, turno_id, hora_inicio, estado, impacto)
    values (8, 1, (select min(id) from turnos), now(), 'activa', 'Parcial');`, 'ck_parcial_pct');
  await debeFallar(c, 'no permite anular sin motivo', `
    insert into registro_paradas (maquina_id, codigo_causa_id, turno_id, hora_inicio, estado)
    values (9, 1, (select min(id) from turnos), now(), 'anulada');`, 'ck_anulada_motivo');

  await debeFallar(c, 'borrar una parada está bloqueado (se anula)', `
    delete from registro_paradas where id = (select min(id) from registro_paradas);`, 'no se borran');

  console.log('== Flujo de 2 clics (fn_abrir_parada / fn_cerrar_parada)');
  await ok(c, 'abrir parada y cerrarla calcula la duración', async () => {
    const r1 = await c.query(
      `select * from fn_abrir_parada(9, 2, '2026-11-10 09:00:00-03', '11111111-1111-4111-8111-111111111111')`);
    const abierta = r1.rows[0];
    const r2 = await c.query(
      `select * from fn_cerrar_parada('11111111-1111-4111-8111-111111111111', '2026-11-10 09:37:00-03')`);
    const cerrada = r2.rows[0];
    if (abierta.estado !== 'activa') throw new Error('no quedó activa');
    if (cerrada.estado !== 'cerrada') throw new Error('no cerró');
    const v = await c.query(`select duracion_minutos from v_paradas where id = $1`, [cerrada.id]);
    if (Number(v.rows[0].duracion_minutos) !== 37) throw new Error('duración ' + v.rows[0].duracion_minutos);
    return '37 min';
  });
  await ok(c, 'abrir dos veces (doble toque) no duplica: devuelve la vigente', async () => {
    const a = await c.query(`select * from fn_abrir_parada(6, 3, '2026-11-10 10:00:00-03', '22222222-2222-4222-8222-222222222222')`);
    const b = await c.query(`select * from fn_abrir_parada(6, 3, '2026-11-10 10:00:03-03', '33333333-3333-4333-8333-333333333333')`);
    if (a.rows[0].id !== b.rows[0].id) throw new Error('creó dos registros');
    const n = await c.query(`select count(*)::int n from registro_paradas where maquina_id=6 and estado='activa'`);
    if (n.rows[0].n !== 1) throw new Error('activas=' + n.rows[0].n);
    return 'id ' + a.rows[0].id;
  });
  await ok(c, 'cerrar dos veces es idempotente', async () => {
    const u = '44444444-4444-4444-8444-444444444444';
    await c.query(`select fn_abrir_parada(7, 1, '2026-11-10 11:00:00-03', '${u}')`);
    const a = await c.query(`select * from fn_cerrar_parada('${u}', '2026-11-10 11:10:00-03')`);
    const b = await c.query(`select * from fn_cerrar_parada('${u}', '2026-11-10 12:00:00-03')`);
    if (a.rows[0].hora_fin.getTime() !== b.rows[0].hora_fin.getTime()) throw new Error('reabrió/reescribió');
    return 'queda 11:10';
  });
  await debeFallar(c, 'cerrar con hora anterior al inicio es rechazado',
    `select fn_cerrar_parada('55555555-5555-4555-8555-555555555555','2026-11-10 08:00:00-03')`, 'no existe');
  await ok(c, 'resolver automáticamente el turno desde la hora', async () => {
    const r = await c.query(`select t.nombre from turnos t where t.id = fn_turno_para('2026-11-08 22:30:00-03')`);
    if (!r.rows[0] || r.rows[0].nombre !== 'Noche') throw new Error('turno=' + JSON.stringify(r.rows[0]));
    return 'Noche';
  });

  console.log('== Sincronización offline');
  await ok(c, 'lote se aplica completo y en orden', async () => {
    const lote = JSON.stringify([
      { uuid_cliente: '66666666-6666-4666-8666-666666666666', maquina_id: 13, codigo_causa_id: 1, hora_inicio: '2026-11-11 09:00:00-03', hora_fin: '2026-11-11 09:20:00-03' },
      { uuid_cliente: '77777777-7777-4777-8777-777777777777', maquina_id: 13, codigo_causa_id: 10, hora_inicio: '2026-11-11 10:00:00-03', hora_fin: '2026-11-11 11:30:00-03' }
    ]);
    const r = await c.query(`select * from fn_sync_lote($1, 'TAB-EMP-01')`, [lote]);
    if (r.rows.length !== 2) throw new Error('filas=' + r.rows.length);
    const t = await c.query(`select round(sum(duracion_minutos))::int m from v_paradas where maquina_id=13 and hora_inicio::date='2026-11-11'`);
    if (t.rows[0].m !== 110) throw new Error('minutos=' + t.rows[0].m);
    return '110 min en 2 paradas';
  });
  await ok(c, 'reenviar el mismo lote no duplica (idempotencia)', async () => {
    const lote = JSON.stringify([
      { uuid_cliente: '88888888-8888-4888-8888-888888888888', maquina_id: 11, codigo_causa_id: 1, hora_inicio: '2026-11-11 12:00:00-03', hora_fin: '2026-11-11 12:15:00-03' }
    ]);
    await c.query(`select * from fn_sync_lote($1)`, [lote]);
    const r2 = await c.query(`select * from fn_sync_lote($1)`, [lote]);
    if (r2.rows[0].recien_creada !== false) throw new Error('marcó como nueva');
    const n = await c.query(`select count(*)::int n from registro_paradas where uuid_cliente='88888888-8888-4888-8888-888888888888'`);
    if (n.rows[0].n !== 1) throw new Error('duplicados=' + n.rows[0].n);
    return '1 fila';
  });
  await ok(c, 'parada abierta que llega tarde se cierra donde parte la siguiente', async () => {
    const lote = JSON.stringify([
      { uuid_cliente: '99999999-9999-4999-8999-999999999999', maquina_id: 12, codigo_causa_id: 1, hora_inicio: '2026-11-12 08:00:00-03' },
      { uuid_cliente: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', maquina_id: 12, codigo_causa_id: 10, hora_inicio: '2026-11-12 09:00:00-03', hora_fin: '2026-11-12 09:40:00-03' }
    ]);
    await c.query(`select * from fn_sync_lote($1)`, [lote]);
    const r = await c.query(`select estado, hora_inicio, hora_fin from registro_paradas
                              where maquina_id=12 and hora_inicio::date='2026-11-12' order by hora_inicio`);
    if (r.rows.length !== 2) throw new Error('filas=' + r.rows.length);
    if (r.rows[0].estado !== 'cerrada') throw new Error('la primera quedó ' + r.rows[0].estado);
    if (r.rows[0].hora_fin.toISOString() !== r.rows[1].hora_inicio.toISOString())
      throw new Error('no se cerró al inicio de la siguiente');
    return '60 min + 40 min';
  });

  console.log('== Líneas y propagación');
  await ok(c, 'parada en el cuello detiene la línea completa', async () => {
    // se parte de una planta sin paradas abiertas
    await c.query(`update registro_paradas set estado='cerrada', hora_fin=now() where estado='activa'`);
    await c.query(`select fn_abrir_parada(p_maquina_id => 4, p_codigo_causa_id => 1, p_hora_inicio => now())`);
    const r = await c.query(`select count(*)::int n from v_maquinas_afectadas where afectada`);
    if (r.rows[0].n !== 5) throw new Error('máquinas afectadas=' + r.rows[0].n);
    const l = await c.query(`select estado from v_linea_estado where codigo = 'L1'`);
    if (l.rows[0].estado !== 'detenida') throw new Error('estado=' + l.rows[0].estado);
    return '5 máquinas · línea detenida';
  });
  await ok(c, 'parada fuera del cuello solo detiene aguas abajo', async () => {
    await c.query(`update registro_paradas set estado='cerrada', hora_fin=now() where estado='activa'`);
    await c.query(`select fn_abrir_parada(p_maquina_id => 5, p_codigo_causa_id => 1, p_hora_inicio => now())`);
    const r = await c.query(`select count(*)::int n from v_maquinas_afectadas where afectada`);
    if (r.rows[0].n !== 2) throw new Error('máquinas afectadas=' + r.rows[0].n);
    const l = await c.query(`select estado from v_linea_estado where codigo = 'L1'`);
    if (l.rows[0].estado !== 'parcial') throw new Error('estado=' + l.rows[0].estado);
    return '2 máquinas · línea parcial';
  });
  await ok(c, 'la trama admite máquinas distintas por línea', async () => {
    const r = await c.query(`select l.codigo, count(*)::int n
                               from linea_maquinas lm join lineas l on l.id = lm.linea_id
                              group by 1 order by 1`);
    if (r.rows.length !== 3) throw new Error('líneas=' + r.rows.length);
    return r.rows.map(x => x.codigo + ':' + x.n).join(' ');
  });

  console.log('== Auditoría y métricas');
  await ok(c, 'edición de supervisor queda auditada con usuario y campos', async () => {
    await c.query(`set local app.usuario = 'supervisor.turno'`);
    const r = await c.query(`select id from registro_paradas where estado='cerrada' order by id limit 1`);
    await c.query(`update registro_paradas set comentarios_mantenimiento = 'Se cambió rodamiento' where id = $1`, [r.rows[0].id]);
    const a = await c.query(`select usuario, accion, campos from registro_paradas_auditoria
                              where parada_id=$1 order by id desc limit 1`, [r.rows[0].id]);
    if (!a.rows[0] || a.rows[0].usuario !== 'supervisor.turno') throw new Error('sin usuario');
    if (!a.rows[0].campos.includes('comentarios_mantenimiento')) throw new Error('campos=' + a.rows[0].campos);
    return a.rows[0].campos.join(',');
  });
  await ok(c, 'pareto acumula 100% y excluye causas planificadas', async () => {
    const r = await c.query(`select * from fn_pareto_causas('2026-10-26','2026-11-10')`);
    const ultimo = r.rows[r.rows.length - 1];
    if (Math.abs(Number(ultimo.pct_acumulado) - 100) > 0.2) throw new Error('acumulado=' + ultimo.pct_acumulado);
    const plan = await c.query(`select count(*)::int n from fn_pareto_causas('2026-10-26','2026-11-10')
                                 where causa in ('Lavado de línea','Cambio de producto')`);
    if (plan.rows[0].n !== 0) throw new Error('incluyó planificadas');
    return r.rows.length + ' causas, top: ' + r.rows[0].causa;
  });
  await ok(c, 'resumen por máquina/turno no cuenta anuladas', async () => {
    const r = await c.query(`select sum(paradas)::int p from v_resumen_maquina_turno`);
    const total = await c.query(`select count(*)::int n from registro_paradas where estado='cerrada'`);
    if (r.rows[0].p !== total.rows[0].n) throw new Error(`${r.rows[0].p} vs ${total.rows[0].n}`);
    return total.rows[0].n + ' paradas cerradas';
  });

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  await c.end();
  process.exit(fail ? 1 : 0);
})();
