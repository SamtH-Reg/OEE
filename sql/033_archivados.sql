-- =====================================================================
--  033 · «Archivados»: cuándo se archivó y cuántas etapas tenía
--
--  Para poder revisarlos en un solo lugar (Ajustes → Archivados) hace
--  falta la fecha de archivo y el número de etapas (líneas) del armado.
--  Van al final de la vista: CREATE OR REPLACE no permite reordenar.
-- =====================================================================

alter table recetas add column if not exists archivada_en timestamptz;

create or replace view v_recetas as
select r.id, r.codigo, r.nombre,
       r.especie_id, e.nombre as especie,
       r.producto_id, p.nombre as producto,
       r.linea_id, l.codigo as linea_codigo, l.nombre as linea,
       r.toneladas_turno, r.rendimiento_pct,
       r.vigente_desde, r.vigente_hasta, r.activa, r.notas,
       (select count(*) from receta_maquinas rm where rm.receta_id = r.id)::int as maquinas,
       r.archivada,
       r.archivada_en,
       (select count(*) from receta_etapas et where et.receta_id = r.id)::int as etapas
from recetas r
left join especies e on e.id = r.especie_id
left join productos p on p.id = r.producto_id
left join lineas   l on l.id = r.linea_id
order by r.codigo;
