-- =====================================================================
--  032 · Roles a medida y archivo de procesos (armados)
--
--  · `roles`: catálogo de roles con un NIVEL numérico (1 operador,
--    2 supervisor, 3 administrador). El nivel es lo que decide qué puede
--    hacer un usuario, así se pueden crear roles nuevos («Jefe de turno»,
--    «Calidad»…) sin tocar el código; sólo se les asigna nivel.
--  · `recetas.archivada`: los procesos/armados viejos se archivan y dejan
--    de aparecer en el selector del turno, sin perder el historial.
-- =====================================================================

create table if not exists roles (
    codigo    text     primary key,           -- 'operador', 'jefe-turno'…
    nombre    text     not null unique,
    nivel     smallint not null check (nivel between 1 and 9),
    creado_en timestamptz not null default now()
);

insert into roles (codigo, nombre, nivel) values
    ('operador',   'Operador de máquina', 1),
    ('supervisor', 'Supervisor',          2),
    ('admin',      'Administrador',       3)
on conflict (codigo) do nothing;

-- El rol de un usuario ya no está limitado a los tres de antes: se valida
-- contra la tabla `roles` en la API.
alter table usuarios drop constraint if exists usuarios_rol_check;

alter table recetas add column if not exists archivada boolean not null default false;

-- La vista mantiene su orden y la columna nueva va al final (CREATE OR REPLACE
-- no permite renombrar ni reordenar columnas).
create or replace view v_recetas as
select r.id, r.codigo, r.nombre,
       r.especie_id, e.nombre as especie,
       r.producto_id, p.nombre as producto,
       r.linea_id, l.codigo as linea_codigo, l.nombre as linea,
       r.toneladas_turno, r.rendimiento_pct,
       r.vigente_desde, r.vigente_hasta, r.activa, r.notas,
       (select count(*) from receta_maquinas rm where rm.receta_id = r.id)::int as maquinas,
       r.archivada
from recetas r
left join especies e on e.id = r.especie_id
left join productos p on p.id = r.producto_id
left join lineas   l on l.id = r.linea_id
order by r.codigo;
