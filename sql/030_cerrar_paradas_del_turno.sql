-- =====================================================================
--  030 · Al cerrar el turno se cierran sus paradas
--
--  Las paradas «Fin de turno» (y cualquier otra que quedó abierta) seguían
--  activas después del cierre y se filtraban al día siguiente: con el turno
--  de hoy vacío el tablero mostraba «24 máquinas detenidas».
--
--  1) fn_cerrar_turno cierra las paradas abiertas del turno en el momento
--     del cierre.
--  2) Se limpian las que quedaron abiertas en turnos ya cerrados.
-- =====================================================================

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

    -- cerrar todo lo que quedó abierto de este turno (incluida la parada que se
    -- acaba de abrir arriba): si no, sigue «detenido» al día siguiente
    update registro_paradas
       set estado = 'cerrada',
           hora_fin = greatest(hora_inicio + interval '1 minute', now()),
           cerrado_por = coalesce(p_usuario, 'cierre')
     where turno_id = p_turno_id and estado = 'activa';

    update turno_procesos set hasta = now() where turno_id = p_turno_id and hasta is null;
    update turnos set cerrado = true where id = p_turno_id;

    return jsonb_build_object('ok', true, 'turno_id', p_turno_id, 'paradas', v_n);
end $$;

-- Limpieza: paradas abiertas en turnos que ya están cerrados.
update registro_paradas p
   set estado = 'cerrada',
       hora_fin = greatest(p.hora_inicio + interval '1 minute',
                           coalesce((select max(c.hasta) from turno_procesos c
                                      where c.turno_id = p.turno_id), now())),
       cerrado_por = 'cierre'
 where p.estado = 'activa'
   and exists (select 1 from turnos t where t.id = p.turno_id and t.cerrado);
