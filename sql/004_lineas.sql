-- 004 · Líneas, tramas y propagación de la parada
--
-- Idea: una línea es una SECUENCIA ordenada de máquinas. Cuando una máquina se
-- detiene, la parada se propaga según el criterio configurado en la trama:
--   · 'maquina'      → solo esa máquina
--   · 'aguas_abajo'  → se detiene todo lo que viene después en la línea
--   · 'linea'        → se detiene la línea completa (cuello de botella)
-- El criterio vive en la trama (linea_maquinas.detiene_linea), no en la cabeza
-- del operador: así se mantienen los 2 toques.

create table lineas (
    id          integer generated always as identity primary key,
    codigo      text     not null unique,          -- 'L1'
    nombre      text     not null,
    descripcion text,
    orden       smallint not null default 0,
    activa      boolean  not null default true,
    creado_en   timestamptz not null default now()
);

create table linea_maquinas (
    linea_id      integer  not null references lineas(id) on delete cascade,
    maquina_id    integer  not null references maquinas(id) on delete restrict,
    posicion      smallint not null,                -- 1 = inicio de la línea
    detiene_linea boolean  not null default false,  -- cuello de botella
    primary key (linea_id, maquina_id),
    unique (linea_id, posicion),
    constraint ck_posicion_positiva check (posicion > 0)
);

create index ix_linea_maquinas_maquina on linea_maquinas (maquina_id);

alter table registro_paradas
    add column linea_id integer references lineas(id) on delete set null,
    add column alcance  text check (alcance in ('maquina', 'aguas_abajo', 'linea'));

create index ix_paradas_linea on registro_paradas (linea_id, hora_inicio desc);


-- v_paradas se recrea agregando línea y alcance (columnas al final: CREATE OR REPLACE
-- solo permite añadir, no reordenar).
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
    p.sincronizado_en,
    p.linea_id,
    l.codigo                                                       as linea_codigo,
    l.nombre                                                       as linea,
    p.alcance
from registro_paradas p
join maquinas          m  on m.id  = p.maquina_id
join areas             a  on a.id  = m.area_id
join codigos_causa     c  on c.id  = p.codigo_causa_id
join categorias_falla  cf on cf.id = c.categoria_id
join turnos            t  on t.id  = p.turno_id
left join lineas       l  on l.id  = p.linea_id;

-- ---------------------------------------------------------------------
-- Alcance sugerido para una máquina según su rol en la trama
-- ---------------------------------------------------------------------
create or replace function fn_alcance_sugerido(p_maquina_id integer)
returns text
language sql stable as $fn$
    select case
             when coalesce(bool_or(lm.detiene_linea), false) then 'linea'
             when count(*) > 0 then 'aguas_abajo'
             else 'maquina'
           end
    from linea_maquinas lm
    where lm.maquina_id = p_maquina_id;
$fn$;

-- ---------------------------------------------------------------------
-- Abrir parada: ahora resuelve línea y alcance por sí sola.
-- (mismos parámetros posicionales + 2 opcionales al final)
-- ---------------------------------------------------------------------
-- Al agregar parámetros, PostgreSQL crea una SOBRECARGA: hay que eliminar la
-- versión anterior (10 argumentos) o las llamadas por nombre quedan ambiguas.
drop function if exists fn_abrir_parada(integer, integer, timestamptz, uuid, text, numeric, text, bigint, text, text);

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
    p_usuario         text        default null,
    p_linea_id        integer     default null,
    p_alcance         text        default null
) returns registro_paradas
language plpgsql as $fn$
declare
    v_fila    registro_paradas;
    v_turno   bigint;
    v_linea   integer;
    v_alcance text;
begin
    select * into v_fila from registro_paradas where uuid_cliente = p_uuid_cliente;
    if found then return v_fila; end if;

    select * into v_fila from registro_paradas
     where maquina_id = p_maquina_id and estado = 'activa';
    if found then return v_fila; end if;

    v_linea := p_linea_id;
    if v_linea is null then
        select lm.linea_id into v_linea
        from linea_maquinas lm
        where lm.maquina_id = p_maquina_id
        order by lm.linea_id
        limit 1;
    end if;

    v_alcance := coalesce(p_alcance, fn_alcance_sugerido(p_maquina_id));

    v_turno := coalesce(p_turno_id, fn_turno_para(p_hora_inicio));
    if v_turno is null then
        raise exception 'No existe turno para % (créelo antes de registrar)', p_hora_inicio;
    end if;

    insert into registro_paradas (
        uuid_cliente, maquina_id, codigo_causa_id, turno_id, hora_inicio,
        impacto, porcentaje_afectacion, comentarios_operador,
        estado, origen, dispositivo_id, registrado_en, creado_por,
        linea_id, alcance)
    values (
        p_uuid_cliente, p_maquina_id, p_codigo_causa_id, v_turno, p_hora_inicio,
        p_impacto, p_pct_afectacion, p_comentario,
        'activa', 'tablet', p_dispositivo_id, p_hora_inicio, p_usuario,
        v_linea, v_alcance)
    returning * into v_fila;

    return v_fila;
end $fn$;

-- La sincronización offline también resuelve línea y alcance.
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
    v_linea  integer;
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
        if exists (select 1 from registro_paradas p where p.uuid_cliente = r.uuid_cliente) then
            return query
                select r.uuid_cliente, p.id, p.estado, false
                from registro_paradas p where p.uuid_cliente = r.uuid_cliente;
            continue;
        end if;

        v_fin := r.hora_fin;

        select p.* into v_activa from registro_paradas p
         where p.maquina_id = r.maquina_id and p.estado = 'activa'
         limit 1;

        if found then
            if v_activa.hora_inicio > r.hora_inicio then
                v_fin := greatest(v_activa.hora_inicio, r.hora_inicio + interval '1 minute');
            else
                update registro_paradas
                   set hora_fin = greatest(r.hora_inicio, v_activa.hora_inicio + interval '1 minute'),
                       estado   = 'cerrada',
                       cerrado_por = coalesce(p_usuario, 'sync')
                 where id = v_activa.id;
            end if;
        end if;

        v_turno := coalesce(r.turno_id, fn_turno_para(r.hora_inicio));
        if v_turno is null then
            raise exception 'Sin turno para % (máquina %)', r.hora_inicio, r.maquina_id;
        end if;

        select lm.linea_id into v_linea
        from linea_maquinas lm where lm.maquina_id = r.maquina_id
        order by lm.linea_id limit 1;

        v_estado := case when v_fin is null then 'activa' else 'cerrada' end;

        insert into registro_paradas (
            uuid_cliente, maquina_id, codigo_causa_id, turno_id,
            hora_inicio, hora_fin, impacto, porcentaje_afectacion,
            comentarios_operador, estado, origen, dispositivo_id,
            registrado_en, sincronizado_en, creado_por, cerrado_por,
            linea_id, alcance)
        values (
            r.uuid_cliente, r.maquina_id, r.codigo_causa_id, v_turno,
            r.hora_inicio, v_fin,
            coalesce(r.impacto, 'Total'), r.porcentaje_afectacion,
            r.comentarios_operador, v_estado, 'offline', p_dispositivo,
            r.hora_inicio, now(), p_usuario,
            case when v_fin is null then null else coalesce(p_usuario, 'sync') end,
            v_linea, fn_alcance_sugerido(r.maquina_id))
        returning id into v_id;

        return query select r.uuid_cliente, v_id, v_estado, true;
    end loop;
end $fn$;

-- ---------------------------------------------------------------------
-- Estado de la línea y máquinas afectadas por propagación
-- ---------------------------------------------------------------------
create or replace view v_linea_estado as
select l.id                       as linea_id,
       l.codigo,
       l.nombre,
       l.orden,
       (select count(*) from linea_maquinas lm where lm.linea_id = l.id)::int as maquinas,
       p.uuid_cliente             as parada_uuid,
       p.causa,
       p.maquina                  as maquina_origen,
       p.maquina_id               as maquina_origen_id,
       p.alcance,
       p.hora_inicio,
       p.duracion_minutos,
       case when p.uuid_cliente is null            then 'operando'
            when p.alcance = 'linea'               then 'detenida'
            else 'parcial'
       end                        as estado
from lineas l
left join lateral (
    select v.* from v_paradas v
     where v.linea_id = l.id and v.estado = 'activa'
     order by v.hora_inicio
     limit 1
) p on true
where l.activa
order by l.orden, l.nombre;

-- Qué máquinas quedan detenidas por cada parada activa (incluye la de origen).
create or replace view v_maquinas_afectadas as
select p.uuid_cliente as parada_uuid,
       p.linea_id,
       lm.maquina_id,
       m.nombre_corto,
       lm.posicion,
       p.causa,
       p.maquina      as origen,
       p.maquina_id   as origen_id,
       p.alcance,
       p.hora_inicio,
       p.duracion_minutos,
       case p.alcance
            when 'linea'       then true
            when 'aguas_abajo' then lm.posicion >= lo.posicion
            else lm.maquina_id = p.maquina_id
       end as afectada
from v_paradas p
join linea_maquinas lo on lo.linea_id = p.linea_id and lo.maquina_id = p.maquina_id
join linea_maquinas lm on lm.linea_id = p.linea_id
join maquinas m on m.id = lm.maquina_id
where p.estado = 'activa'
  and p.linea_id is not null;

-- Minutos-máquina reales (una parada puede detener varias máquinas).
-- El Pareto NO usa esta vista: ahí se cuenta el evento una sola vez.
create or replace view v_paradas_efectivas as
select a.linea_id,
       a.maquina_id,
       a.parada_uuid,
       a.causa,
       a.origen,
       a.alcance,
       a.hora_inicio,
       p.hora_fin,
       p.duracion_minutos,
       p.categoria,
       p.es_planificada
from v_maquinas_afectadas a
join v_paradas p on p.uuid_cliente = a.parada_uuid
where a.afectada;
