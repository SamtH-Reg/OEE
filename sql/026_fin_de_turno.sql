-- =====================================================================
--  026 · Fin de turno
--
--  Una parada planificada «Fin de turno» para cuando el proceso se corta
--  porque terminó el turno (no es una falla ni tiempo perdido), y una
--  función que cierra el turno de una vez: abre esa parada en cada línea
--  armada que esté operando, cierra el corte de proceso abierto y marca
--  el turno como cerrado.
-- =====================================================================

insert into codigos_causa (categoria_id, codigo, descripcion, es_planificada, requiere_comentario, activo)
select (select id from categorias_falla order by orden, id limit 1),
       'FIN-TURNO', 'Fin de turno', true, false, true
 where not exists (select 1 from codigos_causa where descripcion = 'Fin de turno');

create or replace function fn_cerrar_turno(p_turno_id bigint, p_usuario text default null)
returns jsonb
language plpgsql as $$
declare
    v_linea   integer;
    v_maquina integer;
    v_causa   integer;
    v_n       integer := 0;
begin
    select id into v_causa from codigos_causa where descripcion = 'Fin de turno' limit 1;
    if v_causa is null then
        raise exception 'falta la causa «Fin de turno»';
    end if;

    -- una parada de fin de turno por línea armada, si no tiene una parada activa
    for v_linea in
        select distinct e.linea_id
          from receta_etapas e
          join turnos t on t.proceso_id = e.receta_id
         where t.id = p_turno_id and e.tipo = 'linea'
    loop
        if exists (
            select 1
              from registro_paradas p
              join linea_maquinas lm on lm.maquina_id = p.maquina_id
             where lm.linea_id = v_linea and p.estado = 'activa'
        ) then
            continue;
        end if;

        -- el bloque que representa la línea: su cuello, si no su Eventualidades
        select lm.maquina_id into v_maquina
          from linea_maquinas lm
          join maquinas m on m.id = lm.maquina_id
         where lm.linea_id = v_linea
         order by lm.detiene_linea desc,
                  (m.nombre_corto like 'Eventualidades%') desc,
                  lm.posicion
         limit 1;
        if v_maquina is null then
            continue;
        end if;

        perform fn_abrir_parada(
            p_maquina_id      => v_maquina,
            p_codigo_causa_id => v_causa,
            p_turno_id        => p_turno_id,
            p_usuario         => coalesce(p_usuario, 'cierre'),
            p_linea_id        => v_linea
        );
        v_n := v_n + 1;
    end loop;

    update turno_procesos set hasta = now() where turno_id = p_turno_id and hasta is null;
    update turnos set cerrado = true where id = p_turno_id;

    return jsonb_build_object('ok', true, 'turno_id', p_turno_id, 'paradas', v_n);
end $$;
