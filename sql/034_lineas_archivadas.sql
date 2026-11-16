-- =====================================================================
--  034 · Líneas archivadas (para poder reactivarlas después)
--
--  Archivar una línea la saca del turno, pero suele ser temporal: una línea
--  termina antes y más tarde hay que volver a ponerla a trabajar. Se guarda
--  cada archivo con su línea, el proceso del momento y la hora, y se marca
--  cuando se reactiva.
-- =====================================================================

create table if not exists lineas_archivadas (
  id            serial primary key,
  linea_id      integer not null references lineas(id) on delete cascade,
  turno_id      integer references turnos(id) on delete set null,
  proceso_id    integer references recetas(id) on delete set null,
  archivada_en  timestamptz not null default now(),
  reactivada_en timestamptz,
  usuario       text
);

create index if not exists ix_lineas_archivadas_pend
  on lineas_archivadas (reactivada_en, archivada_en desc);

-- lista de las que siguen archivadas, con el nombre y el proceso de ese momento
create or replace view v_lineas_archivadas as
select la.id, la.linea_id, l.nombre as linea, la.proceso_id, r.nombre as proceso,
       la.archivada_en, la.reactivada_en, la.usuario
from lineas_archivadas la
join lineas l on l.id = la.linea_id
left join recetas r on r.id = la.proceso_id
order by la.archivada_en desc;
