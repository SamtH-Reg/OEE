-- =====================================================================
--  REGISTRO DE PARADAS DE PLANTA  ·  Friosur / planta pesquera
--  Motor: PostgreSQL 14+  (compatible con Supabase)
--  Autor: propuesta técnica v1.0
--
--  Convenciones
--   · Zona horaria de la planta: America/Punta_Arenas (UTC-03, sin DST).
--     Se guarda todo en timestamptz (UTC) y se muestra en hora local.
--   · Los catálogos usan id entero + código legible: el código viaja en la
--     tablet y sobrevive a reconstrucciones de la base.
--   · registro_paradas.uuid_cliente lo genera el dispositivo: es la clave
--     de idempotencia de la sincronización offline (nunca se duplica).
--   · Nada se borra: una parada mal registrada se anula (estado='anulada')
--     y queda auditada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ÁREAS Y MÁQUINAS
-- ---------------------------------------------------------------------
create table areas (
    id          integer generated always as identity primary key,
    codigo      text        not null unique,          -- 'FIL', 'CON', 'EMP'
    nombre      text        not null unique,          -- 'Fileteo', 'Congelado'
    orden       smallint    not null default 0,       -- orden en el tablero
    activa      boolean     not null default true,
    creado_en   timestamptz not null default now()
);

create table maquinas (
    id          integer generated always as identity primary key,
    area_id     integer     not null references areas(id) on delete restrict,
    codigo       text        not null unique,         -- 'CIN-01' (va impreso en la máquina)
    nombre       text        not null,                -- 'Cinta Transportadora 1' (informes)
    nombre_corto text        not null,                -- 'Cinta 1' (tarjeta del tablero)
    criticidad  smallint    not null default 2 check (criticidad between 1 and 3),
    orden       smallint    not null default 0,
    activa      boolean     not null default true,
    creado_en   timestamptz not null default now(),
    unique (area_id, nombre)
);

-- El tablero de la tablet pide las máquinas activas por área, en orden.
create index ix_maquinas_area on maquinas (area_id, orden) where activa;

-- ---------------------------------------------------------------------
-- 2. CATÁLOGO DE FALLAS (2 niveles: categoría -> causa concreta)
--    La tablet pinta 5 botones gigantes con las categorías y dentro las
--    causas de esa categoría. Nada más.
-- ---------------------------------------------------------------------
create table categorias_falla (
    id      smallint generated always as identity primary key,
    codigo  text     not null unique,                 -- 'MEC', 'ELE', 'SRV'
    nombre  text     not null unique,                 -- 'Mecánica', 'Eléctrica'
    icono   text,                                     -- nombre de icono en la UI
    color   text     check (color ~ '^#[0-9A-Fa-f]{6}$'),
    orden   smallint not null default 0,
    activa  boolean  not null default true
);

create table codigos_causa (
    id                  integer generated always as identity primary key,
    categoria_id        smallint not null references categorias_falla(id) on delete restrict,
    codigo              text     not null unique,     -- 'MEC-CIN-TRAB'
    descripcion         text     not null,            -- 'Cinta trabada'
    -- Una causa planificada (lavado de línea, cambio de formato, mantención
    -- programada) NO es tiempo muerto: se excluye del Pareto por defecto.
    es_planificada      boolean  not null default false,
    requiere_comentario boolean  not null default false,
    activo              boolean  not null default true,
    unique (categoria_id, descripcion)
);

-- ---------------------------------------------------------------------
-- 3. TURNOS
--    fecha = día de INICIO del turno. Un turno de noche que empieza el
--    09 a las 20:00 y termina el 10 a las 08:00 tiene fecha = 09.
-- ---------------------------------------------------------------------
create table turnos (
    id                      bigint generated always as identity primary key,
    fecha                   date         not null,
    nombre                  text         not null check (nombre in ('Día', 'Noche')),
    supervisor              text         not null,
    toneladas_planificadas  numeric(10,2) check (toneladas_planificadas >= 0),
    hora_inicio             time         not null default '08:00',
    hora_fin                time         not null default '20:00',
    cerrado                 boolean      not null default false,  -- bloquea ediciones del operador
    creado_en               timestamptz  not null default now(),
    constraint ck_turno_horas check (hora_inicio <> hora_fin),
    unique (fecha, nombre)
);

-- ---------------------------------------------------------------------
-- 4. DISPOSITIVOS (tablets / panel PC) — control de salud del parque
-- ---------------------------------------------------------------------
create table dispositivos (
    id                    text primary key,           -- 'TAB-FILETEO-01'
    nombre                text not null,
    area_id               integer references areas(id) on delete set null,
    ultima_sincronizacion timestamptz,                -- última vez que subió la cola
    pendientes            integer not null default 0, -- registros en cola local
    version_app           text,
    activo                boolean not null default true
);

-- ---------------------------------------------------------------------
-- 5. REGISTRO DE PARADAS (tabla de hechos)
-- ---------------------------------------------------------------------
create table registro_paradas (
    id                        bigint generated always as identity primary key,

    -- Idempotencia offline: lo genera el dispositivo (UUID v4) antes de
    -- intentar la red. Si el POST se reintenta, no se duplica.
    uuid_cliente              uuid        not null default gen_random_uuid(),

    maquina_id                integer     not null references maquinas(id) on delete restrict,
    codigo_causa_id           integer     not null references codigos_causa(id) on delete restrict,
    turno_id                  bigint      not null references turnos(id) on delete restrict,

    hora_inicio               timestamptz not null,
    hora_fin                  timestamptz,            -- NULL = parada en curso

    impacto                   text        not null default 'Total'
                              check (impacto in ('Total', 'Parcial')),
    -- Solo aplica a impacto='Parcial': qué fracción de la línea se detuvo.
    porcentaje_afectacion     numeric(5,2)
                              check (porcentaje_afectacion > 0 and porcentaje_afectacion < 100),

    comentarios_operador      text check (char_length(comentarios_operador) <= 500),
    comentarios_mantenimiento text check (char_length(comentarios_mantenimiento) <= 1000),

    estado                    text not null default 'activa'
                              check (estado in ('activa', 'cerrada', 'anulada')),
    motivo_anulacion          text,

    -- Trazabilidad de origen y de relojes (el reloj de la tablet puede
    -- estar desfasado: se guardan los dos y se compara en el panel).
    origen                    text not null default 'tablet'
                              check (origen in ('tablet', 'web', 'offline', 'importado')),
    dispositivo_id            text references dispositivos(id) on delete set null,
    registrado_en             timestamptz not null default now(),   -- reloj del dispositivo
    sincronizado_en           timestamptz not null default now(),   -- reloj del servidor
    creado_por                text,
    cerrado_por               text,
    actualizado_en            timestamptz not null default now(),
    version                   integer not null default 1,           -- control de concurrencia

    -- ---- Reglas de integridad ----
    constraint ck_uuid_cliente_unico unique (uuid_cliente),
    constraint ck_fin_posterior check (hora_fin is null or hora_fin > hora_inicio),
    constraint ck_estado_horas check (
        (estado = 'activa'  and hora_fin is null) or
        (estado = 'cerrada' and hora_fin is not null) or
        (estado = 'anulada')
    ),
    constraint ck_parcial_pct check (
        (impacto = 'Parcial' and porcentaje_afectacion is not null) or
        (impacto = 'Total'   and porcentaje_afectacion is null)
    ),
    constraint ck_anulada_motivo check (estado <> 'anulada' or motivo_anulacion is not null)
);

-- UNA SOLA PARADA ABIERTA POR MÁQUINA. Es la regla que evita el desorden
-- clásico: dos operadores registran la misma detención en paralelo.
create unique index ux_parada_abierta_por_maquina
    on registro_paradas (maquina_id)
    where estado = 'activa';

create index ix_paradas_maquina_fecha on registro_paradas (maquina_id, hora_inicio desc);
create index ix_paradas_turno         on registro_paradas (turno_id, hora_inicio);
create index ix_paradas_causa         on registro_paradas (codigo_causa_id);
create index ix_paradas_abiertas      on registro_paradas (hora_inicio) where estado = 'activa';
create index ix_paradas_dia           on registro_paradas (date_trunc('day', hora_inicio at time zone 'America/Punta_Arenas'));

-- ---------------------------------------------------------------------
-- 6. AUDITORÍA (toda corrección de supervisor queda con autor y diff)
-- ---------------------------------------------------------------------
create table registro_paradas_auditoria (
    id           bigint generated always as identity primary key,
    parada_id    bigint      references registro_paradas(id) on delete cascade,
    accion       text        not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
    campos       text[],                       -- columnas modificadas
    anterior     jsonb,
    nuevo        jsonb,
    usuario      text,
    ocurrido_en  timestamptz not null default now()
);

create index ix_auditoria_parada on registro_paradas_auditoria (parada_id, ocurrido_en desc);

-- ---------------------------------------------------------------------
-- 7. TRIGGERS DE MANTENIMIENTO Y AUDITORÍA
-- ---------------------------------------------------------------------
create or replace function fn_touch_parada() returns trigger
language plpgsql as $$
begin
    new.actualizado_en := now();
    new.version        := old.version + 1;
    return new;
end $$;

-- Guarda quién cambió qué. El usuario se inyecta por transacción:
--   set local app.usuario = 'jose.huequen';
create or replace function fn_auditar_parada() returns trigger
language plpgsql as $$
declare
    v_campos text[];
begin
    if tg_op = 'UPDATE' then
        select array_agg(n.key order by n.key) into v_campos
        from jsonb_each(to_jsonb(new)) n
        join jsonb_each(to_jsonb(old)) o on o.key = n.key
        where n.value is distinct from o.value;

        if v_campos is null then
            return new;                      -- update sin cambios reales
        end if;
    end if;

    insert into registro_paradas_auditoria (parada_id, accion, campos, anterior, nuevo, usuario)
    values (case when tg_op = 'DELETE' then null else coalesce(new.id, old.id) end,
            tg_op,
            v_campos,
            case when tg_op = 'INSERT' then null else to_jsonb(old) end,
            case when tg_op = 'DELETE' then null else to_jsonb(new) end,
            coalesce(current_setting('app.usuario', true), 'sistema'));
    return coalesce(new, old);
end $$;

drop trigger if exists tr_paradas_touch on registro_paradas;
create trigger tr_paradas_touch
    before update on registro_paradas
    for each row execute function fn_touch_parada();

drop trigger if exists tr_paradas_auditoria on registro_paradas;
create trigger tr_paradas_auditoria
    after insert or update or delete on registro_paradas
    for each row execute function fn_auditar_parada();

-- ---------------------------------------------------------------------
-- 8. FUNCIONES DE OPERACIÓN
-- ---------------------------------------------------------------------

-- Turno que corresponde a un instante (soporta turnos que cruzan medianoche).
create or replace function fn_turno_para(p_momento timestamptz)
returns bigint
language sql stable as $fn$
    with local as (
        select (p_momento at time zone 'America/Punta_Arenas') as l
    )
    select t.id
    from turnos t, local
    where case
            when t.hora_fin > t.hora_inicio
                then t.fecha = l::date
                 and l::time >= t.hora_inicio
                 and l::time <  t.hora_fin
            else (t.fecha = l::date     and l::time >= t.hora_inicio)
              or (t.fecha = l::date - 1 and l::time <  t.hora_fin)
          end
    order by t.fecha desc
    limit 1;
$fn$;

-- CLIC 1 + CLIC 2 del operador -> abrir parada.
-- Idempotente por uuid_cliente y por máquina: si la máquina ya está parada,
-- devuelve la parada vigente en lugar de fallar (el operador no ve errores).
create or replace function fn_abrir_parada(
    p_maquina_id      integer,
    p_codigo_causa_id integer,
    p_hora_inicio     timestamptz default now(),
    p_uuid_cliente    uuid        default gen_random_uuid(),
    p_impacto         text        default 'Total',
    p_pct_afectacion  numeric     default null,
    p_comentario      text        default null,
    p_turno_id        bigint      default null,
    p_dispositivo_id  text        default null,
    p_usuario         text        default null
) returns registro_paradas
language plpgsql as $fn$
declare
    v_fila  registro_paradas;
    v_turno bigint;
begin
    -- ¿reintento del mismo registro?
    select * into v_fila from registro_paradas where uuid_cliente = p_uuid_cliente;
    if found then return v_fila; end if;

    -- ¿la máquina ya está detenida? devolver la vigente
    select * into v_fila from registro_paradas
     where maquina_id = p_maquina_id and estado = 'activa';
    if found then return v_fila; end if;

    v_turno := coalesce(p_turno_id, fn_turno_para(p_hora_inicio));
    if v_turno is null then
        raise exception 'No existe turno para % (créelo antes de registrar)', p_hora_inicio;
    end if;

    insert into registro_paradas (
        uuid_cliente, maquina_id, codigo_causa_id, turno_id, hora_inicio,
        impacto, porcentaje_afectacion, comentarios_operador,
        estado, origen, dispositivo_id, registrado_en, creado_por)
    values (
        p_uuid_cliente, p_maquina_id, p_codigo_causa_id, v_turno, p_hora_inicio,
        p_impacto, p_pct_afectacion, p_comentario,
        'activa', 'tablet', p_dispositivo_id, p_hora_inicio, p_usuario)
    returning * into v_fila;

    return v_fila;
end $fn$;

-- CLIC 1 + CLIC 2 al reanudar -> cerrar parada. Idempotente.
create or replace function fn_cerrar_parada(
    p_uuid_cliente uuid,
    p_hora_fin     timestamptz default now(),
    p_comentario   text        default null,
    p_usuario      text        default null
) returns registro_paradas
language plpgsql as $fn$
declare
    v_fila registro_paradas;
begin
    select * into v_fila from registro_paradas
     where uuid_cliente = p_uuid_cliente
       for update;

    if not found then
        raise exception 'Parada % no existe', p_uuid_cliente;
    end if;

    if v_fila.estado = 'cerrada' then
        return v_fila;                    -- reintento: no se toca
    end if;
    if v_fila.estado = 'anulada' then
        raise exception 'La parada % está anulada', p_uuid_cliente;
    end if;
    if p_hora_fin <= v_fila.hora_inicio then
        raise exception 'Hora de fin (%) no puede ser anterior al inicio (%)',
                        p_hora_fin, v_fila.hora_inicio;
    end if;

    update registro_paradas
       set hora_fin    = p_hora_fin,
           estado      = 'cerrada',
           comentarios_operador = coalesce(p_comentario, comentarios_operador),
           cerrado_por = p_usuario,
           sincronizado_en = now()
     where id = v_fila.id
    returning * into v_fila;

    return v_fila;
end $fn$;

-- SINCRONIZACIÓN OFFLINE: recibe el lote de la cola local (JSON) y lo aplica.
-- Reglas:
--   · idempotente por uuid_cliente (los reintentos no duplican)
--   · se procesa en orden cronológico
--   · nunca quedan dos paradas abiertas en la misma máquina
create or replace function fn_sync_lote(
    p_lote        jsonb,
    p_dispositivo text default null,
    p_usuario     text default null
) returns table (uuid_cliente uuid, parada_id bigint, estado text, recien_creada boolean)
language plpgsql as $fn$
declare
    r        record;
    v_turno  bigint;
    v_id     bigint;
    v_activa registro_paradas;
    v_fin    timestamptz;
    v_estado text;
begin
    for r in
        select x.*
        from jsonb_to_recordset(p_lote) as x(
            uuid_cliente          uuid,
            maquina_id            integer,
            codigo_causa_id       integer,
            turno_id              bigint,
            hora_inicio           timestamptz,
            hora_fin              timestamptz,
            impacto               text,
            porcentaje_afectacion numeric,
            comentarios_operador  text
        )
        order by x.hora_inicio
    loop
        -- 1. ¿ya existe?
        if exists (select 1 from registro_paradas p where p.uuid_cliente = r.uuid_cliente) then
            return query
                select r.uuid_cliente, p.id, p.estado, false
                from registro_paradas p where p.uuid_cliente = r.uuid_cliente;
            continue;
        end if;

        v_fin := r.hora_fin;

        -- 2. resolver la parada abierta de esa máquina, si hay
        select p.* into v_activa from registro_paradas p
         where p.maquina_id = r.maquina_id and p.estado = 'activa'
         limit 1;

        if found then
            if v_activa.hora_inicio > r.hora_inicio then
                -- llega tarde una parada anterior: se cierra donde parte la vigente
                v_fin := greatest(v_activa.hora_inicio, r.hora_inicio + interval '1 minute');
            else
                -- la vigente es anterior: se cierra donde parte la que llega
                update registro_paradas
                   set hora_fin = greatest(r.hora_inicio, v_activa.hora_inicio + interval '1 minute'),
                       estado   = 'cerrada',
                       cerrado_por = coalesce(p_usuario, 'sync')
                 where id = v_activa.id;
            end if;
        end if;

        -- 3. turno
        v_turno := coalesce(r.turno_id, fn_turno_para(r.hora_inicio));
        if v_turno is null then
            raise exception 'Sin turno para % (máquina %)', r.hora_inicio, r.maquina_id;
        end if;

        v_estado := case when v_fin is null then 'activa' else 'cerrada' end;

        insert into registro_paradas (
            uuid_cliente, maquina_id, codigo_causa_id, turno_id,
            hora_inicio, hora_fin, impacto, porcentaje_afectacion,
            comentarios_operador, estado, origen, dispositivo_id,
            registrado_en, sincronizado_en, creado_por,
            cerrado_por)
        values (
            r.uuid_cliente, r.maquina_id, r.codigo_causa_id, v_turno,
            r.hora_inicio, v_fin,
            coalesce(r.impacto, 'Total'), r.porcentaje_afectacion,
            r.comentarios_operador, v_estado, 'offline', p_dispositivo,
            r.hora_inicio, now(), p_usuario,
            case when v_fin is null then null else coalesce(p_usuario, 'sync') end)
        returning id into v_id;

        return query select r.uuid_cliente, v_id, v_estado, true;
    end loop;
end $fn$;

-- ---------------------------------------------------------------------
-- 9. VISTAS DE LECTURA (tablero, historial y analítica)
-- ---------------------------------------------------------------------

-- Una fila por parada, ya resuelta con nombres, duración y turno.
create or replace view v_paradas as
select
    p.id,
    p.uuid_cliente,
    (p.hora_inicio at time zone 'America/Punta_Arenas')::date      as fecha,
    p.turno_id,
    t.fecha                                                        as fecha_turno,
    t.nombre                                                       as turno,
    t.supervisor,
    a.id                                                           as area_id,
    a.nombre                                                       as area,
    m.id                                                           as maquina_id,
    m.nombre                                                       as maquina,
    m.nombre_corto                                                 as maquina_corto,
    m.codigo                                                       as maquina_codigo,
    m.criticidad,
    cf.id                                                          as categoria_id,
    cf.nombre                                                      as categoria,
    c.id                                                           as codigo_causa_id,
    c.codigo                                                       as causa_codigo,
    c.descripcion                                                  as causa,
    c.es_planificada,
    p.impacto,
    p.porcentaje_afectacion,
    p.hora_inicio,
    p.hora_fin,
    round(extract(epoch from (coalesce(p.hora_fin, now()) - p.hora_inicio)) / 60.0, 1) as duracion_minutos,
    (p.estado = 'activa')                                          as en_curso,
    p.estado,
    p.comentarios_operador,
    p.comentarios_mantenimiento,
    p.origen,
    p.dispositivo_id,
    p.registrado_en,
    p.sincronizado_en
from registro_paradas p
join maquinas          m  on m.id  = p.maquina_id
join areas             a  on a.id  = m.area_id
join codigos_causa     c  on c.id  = p.codigo_causa_id
join categorias_falla  cf on cf.id = c.categoria_id
join turnos            t  on t.id  = p.turno_id;

-- Minutos acumulados por máquina y turno (indicador de duración total).
create or replace view v_resumen_maquina_turno as
select
    p.turno_id,
    p.fecha_turno,
    p.turno,
    p.supervisor,
    p.area_id,
    p.area,
    p.maquina_id,
    p.maquina,
    count(*) filter (where p.estado = 'cerrada')                                  as paradas,
    count(*) filter (where p.estado = 'cerrada' and not p.es_planificada)         as paradas_no_planificadas,
    coalesce(round(sum(p.duracion_minutos) filter (where p.estado = 'cerrada' and not p.es_planificada), 1), 0) as minutos_no_planificados,
    coalesce(round(sum(p.duracion_minutos) filter (where p.estado = 'cerrada' and p.es_planificada), 1), 0)     as minutos_planificados,
    coalesce(round(sum(p.duracion_minutos) filter (where p.estado = 'cerrada'), 1), 0)                          as minutos_totales
from v_paradas p
where p.estado <> 'anulada'
group by 1, 2, 3, 4, 5, 6, 7, 8;

-- Duración planificada de un turno (720 min en turnos de 12 h).
create or replace function fn_minutos_turno(p_turno_id bigint)
returns numeric
language sql stable as $fn$
    select round(extract(epoch from (
               (t.fecha + t.hora_fin + case when t.hora_fin <= t.hora_inicio
                                             then interval '1 day' else interval '0' end)
               - (t.fecha + t.hora_inicio)
           )) / 60.0, 0)
    from turnos t
    where t.id = p_turno_id;
$fn$;

-- Disponibilidad POR MÁQUINA y turno (la unidad correcta para OEE).
create or replace view v_disponibilidad_maquina_turno as
select r.fecha_turno,
       r.turno,
       r.area,
       r.maquina_id,
       r.maquina,
       fn_minutos_turno(r.turno_id)                    as minutos_turno,
       r.minutos_no_planificados,
       r.minutos_planificados,
       r.paradas,
       round(100 * (1 - r.minutos_no_planificados / nullif(fn_minutos_turno(r.turno_id), 0)), 1) as disponibilidad_pct
from v_resumen_maquina_turno r;

-- Disponibilidad del turno = minutos-máquina disponibles vs detenidos.
-- (No se suman minutos de máquinas distintas contra un solo turno: eso
--  inflaría la parada; se compara contra minutos_turno * nº de máquinas.)
create or replace view v_disponibilidad_turno as
with maquinas_activas as (
    select count(*)::numeric as n from maquinas where activa
), paradas as (
    select turno_id,
           sum(minutos_no_planificados) as minutos_no_planificados,
           sum(minutos_planificados)    as minutos_planificados,
           sum(paradas)                 as paradas
    from v_resumen_maquina_turno
    group by turno_id
)
select t.id                                   as turno_id,
       t.fecha,
       t.nombre                               as turno,
       t.supervisor,
       t.toneladas_planificadas,
       fn_minutos_turno(t.id)                 as minutos_turno,
       m.n                                    as maquinas_activas,
       round(coalesce(p.minutos_no_planificados, 0), 1) as minutos_no_planificados,
       round(coalesce(p.minutos_planificados, 0), 1)    as minutos_planificados,
       coalesce(p.paradas, 0)                 as paradas,
       round(100 * (1 - coalesce(p.minutos_no_planificados, 0)
                        / nullif(fn_minutos_turno(t.id) * m.n, 0)), 1) as disponibilidad_pct
from turnos t
cross join maquinas_activas m
left join paradas p on p.turno_id = t.id;
-- ---------------------------------------------------------------------
-- 10. ANALÍTICA: PARETO DE CAUSAS RAÍZ Y MTBF/MTTR
-- ---------------------------------------------------------------------

-- Pareto por causa, con % individual y % acumulado (regla 80/20).
-- Excluye por defecto las causas planificadas (lavado, cambio de formato):
-- esas no son tiempo muerto, son tiempo operativo planificado.
create or replace function fn_pareto_causas(
    p_desde               timestamptz,
    p_hasta               timestamptz,
    p_area_id             integer default null,
    p_incluir_planificadas boolean default false
) returns table (
    posicion        integer,
    codigo_causa_id integer,
    causa           text,
    categoria       text,
    eventos         bigint,
    minutos         numeric,
    pct_tiempo      numeric,
    pct_acumulado   numeric
)
language sql stable as $fn$
    with base as (
        select v.codigo_causa_id,
               v.causa,
               v.categoria,
               count(*)::bigint                as eventos,
               sum(v.duracion_minutos)::numeric as minutos
        from v_paradas v
        where v.estado = 'cerrada'
          and v.hora_inicio >= p_desde
          and v.hora_inicio <  p_hasta
          and (p_area_id is null or v.area_id = p_area_id)
          and (p_incluir_planificadas or not v.es_planificada)
        group by 1, 2, 3
    ), totalizado as (
        select b.*, sum(b.minutos) over () as total
        from base b
    )
    select row_number() over (order by t.minutos desc, t.eventos desc)::integer,
           t.codigo_causa_id,
           t.causa,
           t.categoria,
           t.eventos,
           round(t.minutos, 1),
           round(100 * t.minutos / nullif(t.total, 0), 1),
           round(100 * sum(t.minutos) over (
                     order by t.minutos desc, t.eventos desc
                     rows between unbounded preceding and current row
                 ) / nullif(t.total, 0), 1)
    from totalizado t
    order by t.minutos desc, t.eventos desc;
$fn$;

-- MTTR (tiempo medio de reparación) y MTBF (tiempo medio entre fallas).
create or replace function fn_mtbf_mttr(
    p_desde   timestamptz,
    p_hasta   timestamptz,
    p_area_id integer default null
) returns table (
    maquina_id  integer,
    maquina     text,
    area        text,
    fallas      bigint,
    mttr_min    numeric,
    mtbf_horas  numeric
)
language sql stable as $fn$
    with base as (
        select v.maquina_id, v.maquina, v.area,
               count(*)::bigint                  as fallas,
               avg(v.duracion_minutos)::numeric  as mttr,
               sum(v.duracion_minutos)::numeric  as minutos_muertos
        from v_paradas v
        where v.estado = 'cerrada'
          and not v.es_planificada
          and v.hora_inicio >= p_desde
          and v.hora_inicio <  p_hasta
          and (p_area_id is null or v.area_id = p_area_id)
        group by 1, 2, 3
    )
    select b.maquina_id,
           b.maquina,
           b.area,
           b.fallas,
           round(b.mttr, 1),
           round(((extract(epoch from (p_hasta - p_desde)) / 60.0 - b.minutos_muertos)
                  / nullif(b.fallas, 0)) / 60.0, 1)
    from base b
    order by b.fallas desc, b.maquina;
$fn$;

-- Pareto del mes en curso, listo para el tablero de gerencia.
create or replace view v_pareto_causas_mes as
select p.*,
       round(100 * sum(p.minutos) over (
                 order by p.minutos desc
                 rows between unbounded preceding and current row
             ) / nullif(sum(p.minutos) over (), 0), 1) as pct_acumulado_calc
from (
    select v.codigo_causa_id,
           v.causa,
           v.categoria,
           count(*)::bigint                as eventos,
           round(sum(v.duracion_minutos), 1) as minutos
    from v_paradas v
    where v.estado = 'cerrada'
      and not v.es_planificada
      and v.hora_inicio >= date_trunc('month', now())
    group by 1, 2, 3
) p
order by p.minutos desc;

-- Top de causas por área (para reuniones de producción).
create or replace view v_top_causas_area as
select v.area,
       v.causa,
       v.categoria,
       count(*)::bigint                  as eventos,
       round(sum(v.duracion_minutos), 1) as minutos,
       round(avg(v.duracion_minutos), 1) as promedio_min
from v_paradas v
where v.estado = 'cerrada'
  and not v.es_planificada
  and v.hora_inicio >= now() - interval '30 days'
group by 1, 2, 3
order by v.area, minutos desc;

-- Una parada no se borra: se anula. El borrado queda reservado a mantenimiento
-- (set local app.permitir_borrado = 'on').
create or replace function fn_proteger_parada() returns trigger
language plpgsql as $$
begin
    if coalesce(current_setting('app.permitir_borrado', true), 'off') <> 'on' then
        raise exception 'Las paradas no se borran: se anulan con motivo (estado = anulada)';
    end if;
    return old;
end $$;

drop trigger if exists tr_paradas_proteger on registro_paradas;
create trigger tr_paradas_proteger
    before delete on registro_paradas
    for each row execute function fn_proteger_parada();
