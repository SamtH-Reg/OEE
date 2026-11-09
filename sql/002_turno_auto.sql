-- 002 · Turno automático
-- El operador nunca debe ver «no existe turno»: si la planta arranca un día
-- sin que el supervisor haya creado el turno, se crea al primer registro.

create or replace function fn_asegurar_turno(p_momento timestamptz default now())
returns bigint
language plpgsql as $fn$
declare
    v_hoy  date;
    v_id   bigint;
begin
    v_id := fn_turno_para(p_momento);
    if v_id is not null then
        return v_id;
    end if;

    v_hoy := (p_momento at time zone 'America/Punta_Arenas')::date;

    -- Se crean el día en curso y el anterior: a las 02:00 el turno vigente
    -- es la Noche que empezó ayer.
    insert into turnos (fecha, nombre, supervisor, hora_inicio, hora_fin)
    values (v_hoy,         'Día',   'Supervisor turno', '08:00', '20:00'),
           (v_hoy,         'Noche', 'Supervisor turno', '20:00', '08:00'),
           (v_hoy - 1,     'Día',   'Supervisor turno', '08:00', '20:00'),
           (v_hoy - 1,     'Noche', 'Supervisor turno', '20:00', '08:00')
    on conflict (fecha, nombre) do nothing;

    return fn_turno_para(p_momento);
end $fn$;
