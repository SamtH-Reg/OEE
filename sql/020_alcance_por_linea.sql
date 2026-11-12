-- =====================================================================
--  020 · El alcance de una parada se resuelve para LA LÍNEA de la parada
--
--  Problema: fn_alcance_sugerido(máquina) tomaba bool_or(detiene_linea)
--  sobre TODAS las líneas de la máquina. LINEA 1 (MANUAL) es cuello en
--  «LINEA 1 PORCIONES» pero no en «linea 2 FILETE (IQF)…»; al pararla en
--  la linea 2 el alcance salía 'linea' y el tablero apagaba la línea
--  entera (aguas arriba incluido), como si las conexiones no existieran.
--
--  Ahora el alcance se calcula con la línea de la parada. La línea viaja
--  desde la tablet (es la que el operador está mirando) y, si no viene,
--  se usa la primera de la máquina como antes.
-- =====================================================================

-- create or replace con un parámetro nuevo crea una SOBRECARGA: hay que
-- borrar la versión de un argumento o toda llamada queda ambigua.
drop function if exists fn_alcance_sugerido(integer);

create or replace function fn_alcance_sugerido(p_maquina_id integer, p_linea_id integer default null)
returns text
language sql stable as $fn$
    select case
             when coalesce(bool_or(lm.detiene_linea), false) then 'linea'
             when count(*) > 0 then 'aguas_abajo'
             else 'maquina'
           end
    from linea_maquinas lm
    where lm.maquina_id = p_maquina_id
      and (p_linea_id is null or lm.linea_id = p_linea_id);
$fn$;

-- ---------------------------------------------------------------------
-- fn_abrir_parada: resuelve el alcance con la línea de la parada.
-- (misma firma; sólo cambia la llamada a fn_alcance_sugerido)
-- ---------------------------------------------------------------------
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
language plpgsql as $$
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

    v_alcance := coalesce(p_alcance, fn_alcance_sugerido(p_maquina_id, v_linea));

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
end $$;

-- ---------------------------------------------------------------------
-- fn_sync_lote: el lote puede traer linea_id por evento (la tablet lo
-- manda al registrar sobre una línea concreta).
-- ---------------------------------------------------------------------
create or replace function fn_sync_lote(
    p_lote        jsonb,
    p_dispositivo text default null,
    p_usuario     text default null
) returns table (uuid_cliente uuid, parada_id bigint, estado text, recien_creada boolean)
language plpgsql as $$
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
            comentarios_operador  text,
            linea_id              integer
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

        v_linea := r.linea_id;
        if v_linea is null then
            select lm.linea_id into v_linea
            from linea_maquinas lm where lm.maquina_id = r.maquina_id
            order by lm.linea_id limit 1;
        end if;

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
            v_linea, fn_alcance_sugerido(r.maquina_id, v_linea))
        returning id into v_id;

        return query select r.uuid_cliente, v_id, v_estado, true;
    end loop;
end $$;
