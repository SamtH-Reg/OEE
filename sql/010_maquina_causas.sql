-- 010 · Fallas por equipo
--
-- Cada máquina puede tener su lista de fallas típicas. Si tiene, el operador
-- ve solo esas al registrar una parada (con opción de ver el catálogo completo).
-- Si no tiene ninguna asignada, se comporta como antes: muestra todo el catálogo.

create table maquina_causas (
    maquina_id      integer not null references maquinas(id) on delete cascade,
    codigo_causa_id integer not null references codigos_causa(id) on delete cascade,
    primary key (maquina_id, codigo_causa_id)
);

create index ix_maquina_causas_causa on maquina_causas (codigo_causa_id);

-- Vista cómoda para el panel: fallas agrupadas por equipo.
create or replace view v_maquina_causas as
select mc.maquina_id,
       m.codigo as maquina_codigo,
       mc.codigo_causa_id,
       c.descripcion,
       c.categoria_id,
       cf.nombre as categoria,
       c.es_planificada
from maquina_causas mc
join maquinas m on m.id = mc.maquina_id
join codigos_causa c on c.id = mc.codigo_causa_id
join categorias_falla cf on cf.id = c.categoria_id;
