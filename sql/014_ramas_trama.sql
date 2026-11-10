-- 014 · Ramas paralelas en la trama
--
-- Hasta ahora la trama era una secuencia simple. Una línea real se bifurca:
-- un equipo alimenta varias ramas en paralelo y después se juntan.
-- Cada fila de la trama tiene ahora `posicion` (etapa del flujo) y `rama`
-- (carril dentro de esa etapa). Varias filas con la misma posicion = paralelo.

alter table linea_maquinas
    add column if not exists rama smallint not null default 1;

-- la posición deja de ser única por línea: ahora lo es por (línea, posición, rama)
alter table linea_maquinas drop constraint if exists linea_maquinas_linea_id_posicion_key;
alter table linea_maquinas
    add constraint uq_linea_posicion_rama unique (linea_id, posicion, rama);

create or replace view v_linea_trama as
select lm.linea_id,
       lm.posicion,
       lm.rama,
       lm.maquina_id,
       lm.detiene_linea,
       m.codigo,
       m.nombre_corto,
       m.nombre,
       m.criticidad,
       a.nombre as area
from linea_maquinas lm
join maquinas m on m.id = lm.maquina_id
join areas a on a.id = m.area_id
order by lm.linea_id, lm.posicion, lm.rama;
