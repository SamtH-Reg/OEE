-- =====================================================================
--  025 · Cortes de proceso del turno (desde / hasta)
--
--  Cada vez que el turno cambia de armado (process) se cierra el período
--  anterior y se abre uno nuevo, con una foto de las líneas de ese
--  momento. Así queda «la línea trabajó con esta configuración de las
--  11:00 a las 13:20», aunque después la receta se edite.
-- =====================================================================

create table if not exists turno_procesos (
    id         bigserial primary key,
    turno_id   bigint      not null references turnos(id) on delete cascade,
    receta_id  bigint      references recetas(id) on delete set null,
    desde      timestamptz not null default now(),
    hasta      timestamptz,
    lineas     jsonb       not null default '[]'::jsonb,  -- [{linea_id, nombre, maquinas}]
    usuario    text,
    constraint ck_turno_procesos_rango check (hasta is null or hasta >= desde)
);

create index if not exists ix_turno_procesos_turno on turno_procesos (turno_id, desde desc);

-- un solo período abierto por turno
create unique index if not exists ux_turno_procesos_abierto
    on turno_procesos (turno_id) where hasta is null;

-- Cierra el período abierto y abre el del proceso nuevo. Si es el mismo
-- proceso, no hace nada.
create or replace function fn_registrar_proceso_turno(
    p_turno_id  bigint,
    p_receta_id bigint,
    p_usuario   text default null
) returns turno_procesos
language plpgsql as $$
declare
    v_actual turno_procesos;
    v_lineas jsonb;
    v_row    turno_procesos;
begin
    select * into v_actual
      from turno_procesos
     where turno_id = p_turno_id and hasta is null
     limit 1;

    if v_actual.id is not null
       and v_actual.receta_id is not distinct from p_receta_id then
        return v_actual;                        -- no cambió nada
    end if;

    if v_actual.id is not null then
        update turno_procesos set hasta = now() where id = v_actual.id;
    end if;

    if p_receta_id is null then
        return null;                            -- turno sin proceso
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
                'linea_id', l.id,
                'nombre',   l.nombre,
                'maquinas', (select count(*) from linea_maquinas lm where lm.linea_id = l.id)
             ) order by e.orden), '[]'::jsonb)
      into v_lineas
      from receta_etapas e
      join lineas l on l.id = e.linea_id
     where e.receta_id = p_receta_id and e.tipo = 'linea';

    insert into turno_procesos (turno_id, receta_id, desde, lineas, usuario)
    values (p_turno_id, p_receta_id, now(), coalesce(v_lineas, '[]'::jsonb), p_usuario)
    returning * into v_row;

    return v_row;
end $$;

-- Backfill: el turno abierto que ya tiene proceso arranca su primer período
-- en el momento en que se creó el turno.
insert into turno_procesos (turno_id, receta_id, desde, lineas, usuario)
select t.id, t.proceso_id, t.creado_en,
       coalesce((
         select jsonb_agg(jsonb_build_object(
                  'linea_id', l.id, 'nombre', l.nombre,
                  'maquinas', (select count(*) from linea_maquinas lm where lm.linea_id = l.id)
                ) order by e.orden)
           from receta_etapas e join lineas l on l.id = e.linea_id
          where e.receta_id = t.proceso_id and e.tipo = 'linea'
       ), '[]'::jsonb),
       'sistema'
  from turnos t
 where t.id = fn_turno_para(now())
   and t.proceso_id is not null
   and not exists (select 1 from turno_procesos c where c.turno_id = t.id);
