-- =====================================================================
--  021 · «Eventualidades» pasa a ser una tarjeta ESTÁNDAR E INDEPENDIENTE
--        en cada línea (deja de ser una sola máquina compartida)
--
--  Antes: una única máquina (EVENTUALIDADES, id 68) estaba en la trama de
--  las cuatro líneas. Al detenerla en una línea, se detenía en todas.
--
--  Ahora: cada línea tiene su propia tarjeta, con el mismo nombre corto
--  («Eventualidades»), las mismas fallas asignadas y su lugar en la trama.
--  La línea 18 conserva la original (es la que tiene el historial de
--  paradas) y las demás reciben una copia, reconectando sus aristas.
--  Las líneas nuevas la reciben solas al crearse (server: POST /api/lineas
--  y PUT /api/lineas/:id/trama llaman a fn_asegurar_eventualidades).
-- =====================================================================

-- Crea (si falta) la tarjeta de Eventualidades de una línea y devuelve su id.
create or replace function fn_asegurar_eventualidades(p_linea_id integer)
returns integer
language plpgsql as $$
declare
    v_maquina  integer;
    v_src      maquinas%rowtype;
    v_linea    lineas%rowtype;
    v_pos      smallint;
    v_orden    smallint;
begin
    select m.id into v_maquina
      from linea_maquinas lm
      join maquinas m on m.id = lm.maquina_id
     where lm.linea_id = p_linea_id and m.nombre_corto = 'Eventualidades'
     limit 1;
    if v_maquina is not null then
        return v_maquina;
    end if;

    -- plantilla: la Eventualidades original de la planta
    select * into v_src from maquinas
     where nombre_corto = 'Eventualidades' and activa order by id limit 1;
    if not found then
        return null;
    end if;

    select * into v_linea from lineas where id = p_linea_id;
    if not found then
        return null;
    end if;

    select coalesce(max(orden) + 1, 1) into v_orden from maquinas where area_id = v_src.area_id;
    -- posición libre: la 1 si la línea está vacía; si no, al final (el unique es
    -- (linea_id, posicion, rama), así que el primer hueco real es max+1)
    select coalesce(max(posicion), 0) into v_pos from linea_maquinas where linea_id = p_linea_id;
    v_pos := case when v_pos = 0 then 1 else v_pos + 1 end;

    insert into maquinas (area_id, codigo, nombre, nombre_corto, criticidad, orden, activa)
    values (v_src.area_id,
            upper(regexp_replace(v_linea.codigo, '[^A-Za-z0-9]+', '-', 'g')) || '-EVENT',
            'Eventualidades · ' || v_linea.nombre,
            'Eventualidades', v_src.criticidad, v_orden, true)
    on conflict (codigo) do update set nombre = excluded.nombre
    returning id into v_maquina;

    insert into maquina_causas (maquina_id, codigo_causa_id)
    select v_maquina, mc.codigo_causa_id
      from maquina_causas mc where mc.maquina_id = v_src.id
    on conflict do nothing;

    insert into linea_maquinas (linea_id, maquina_id, posicion, rama, detiene_linea)
    values (p_linea_id, v_maquina, v_pos, 1, false)
    on conflict do nothing;

    return v_maquina;
end $$;

-- ---------------------------------------------------------------------
-- Migración de las líneas que hoy comparten la máquina 68
-- ---------------------------------------------------------------------
do $$
declare
    v_src     maquinas%rowtype;
    v_fila    record;
    v_nueva   integer;
    v_orden   smallint;
begin
    select * into v_src from maquinas where id = 68;
    if not found then
        return;
    end if;

    for v_fila in
        select lm.linea_id, lm.posicion, lm.rama, lm.detiene_linea,
               l.nombre as linea_nombre, l.codigo as linea_codigo
          from linea_maquinas lm
          join lineas l on l.id = lm.linea_id
         where lm.maquina_id = 68
           and lm.linea_id <> 18          -- la 18 se queda con la original
         order by lm.linea_id
    loop
        select coalesce(max(orden) + 1, 1) into v_orden
          from maquinas where area_id = v_src.area_id;

        insert into maquinas (area_id, codigo, nombre, nombre_corto, criticidad, orden, activa)
        values (v_src.area_id,
                upper(regexp_replace(v_fila.linea_codigo, '[^A-Za-z0-9]+', '-', 'g')) || '-EVENT',
                'Eventualidades · ' || v_fila.linea_nombre,
                'Eventualidades', v_src.criticidad, v_orden, true)
        returning id into v_nueva;

        insert into maquina_causas (maquina_id, codigo_causa_id)
        select v_nueva, mc.codigo_causa_id
          from maquina_causas mc where mc.maquina_id = 68
        on conflict do nothing;

        -- misma posición y misma marca de cuello que tenía la compartida
        update linea_maquinas
           set maquina_id = v_nueva
         where linea_id = v_fila.linea_id and maquina_id = 68;

        update linea_conexiones
           set desde_maquina_id = v_nueva
         where linea_id = v_fila.linea_id and desde_maquina_id = 68;

        update linea_conexiones
           set hasta_maquina_id = v_nueva
         where linea_id = v_fila.linea_id and hasta_maquina_id = 68;
    end loop;
end $$;
