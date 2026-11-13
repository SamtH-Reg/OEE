-- =====================================================================
--  024 · fn_asegurar_eventualidades después de numerar las tarjetas
--
--  La 023 renombró los nombres cortos a «Eventualidades 1..4» y la función
--  buscaba exactamente 'Eventualidades', así que dejó de reconocer la tarjeta
--  de la línea (y de crear la de las líneas nuevas). Ahora busca por prefijo y
--  numera la nueva siguiendo la serie del área.
-- =====================================================================

create or replace function fn_asegurar_eventualidades(p_linea_id integer)
returns integer
language plpgsql as $$
declare
    v_maquina  integer;
    v_src      maquinas%rowtype;
    v_linea    lineas%rowtype;
    v_pos      smallint;
    v_orden    smallint;
    v_n        integer := 1;
    v_corto    text;
begin
    select m.id into v_maquina
      from linea_maquinas lm
      join maquinas m on m.id = lm.maquina_id
     where lm.linea_id = p_linea_id and m.nombre_corto like 'Eventualidades%'
     limit 1;
    if v_maquina is not null then
        return v_maquina;
    end if;

    -- plantilla: cualquier Eventualidades de la planta
    select * into v_src from maquinas
     where nombre_corto like 'Eventualidades%' and activa order by id limit 1;
    if not found then
        return null;
    end if;

    select * into v_linea from lineas where id = p_linea_id;
    if not found then
        return null;
    end if;

    -- siguiente número libre del área
    select coalesce(max((regexp_match(nombre_corto, '([0-9]+)\s*$'))[1]::int), 0) + 1
      into v_n
      from maquinas
     where area_id = v_src.area_id and nombre_corto like 'Eventualidades%';
    v_corto := 'Eventualidades ' || v_n;

    select coalesce(max(orden) + 1, 1) into v_orden from maquinas where area_id = v_src.area_id;

    -- posición libre: la 1 si la línea está vacía; si no, al final
    select coalesce(max(posicion), 0) into v_pos from linea_maquinas where linea_id = p_linea_id;
    v_pos := case when v_pos = 0 then 1 else v_pos + 1 end;

    insert into maquinas (area_id, codigo, nombre, nombre_corto, criticidad, orden, activa)
    values (v_src.area_id,
            'EVENTUALIDADES-' || v_n,
            'EVENTUALIDADES ' || v_n,
            v_corto, v_src.criticidad, v_orden, true)
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
