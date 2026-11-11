-- 015 · Conexiones entre bloques (quién alimenta a quién)
--
-- Cada equipo de la trama puede declarar de qué equipo recibe el producto.
-- Con eso el flujo deja de ser una lista y pasa a ser un árbol:
--   Línea 3 -> TRIO 2 -> LINEA RECORTE
--   Línea 2 -> TRIO 1 -> LINEA RECORTE
-- Una parada se propaga por esa conexión, no por la posición en la lista.

alter table linea_maquinas
    add column if not exists padre_maquina_id integer;

alter table linea_maquinas
    drop constraint if exists fk_trama_padre;
alter table linea_maquinas
    add constraint fk_trama_padre
    foreign key (padre_maquina_id) references maquinas(id) on delete set null;

create index if not exists ix_trama_padre on linea_maquinas (linea_id, padre_maquina_id);

-- Afectadas por propagación: todos los descendientes del equipo detenido.
create or replace view v_maquinas_afectadas as
with recursive activas as (
    select p.uuid_cliente,
           p.linea_id,
           p.maquina_id as origen_id,
           p.alcance,
           p.causa,
           p.hora_inicio,
           p.duracion_minutos,
           p.maquina as origen,
           p.maquina_id
    from v_paradas p
    where p.estado = 'activa'
      and p.linea_id is not null
), arbol as (
    select a.uuid_cliente, a.linea_id, a.origen_id, a.alcance, a.causa,
           a.hora_inicio, a.duracion_minutos, a.origen, a.maquina_id, 0 as nivel
    from activas a
    union all
    select t.uuid_cliente, t.linea_id, t.origen_id, t.alcance, t.causa,
           t.hora_inicio, t.duracion_minutos, t.origen, lm.maquina_id, t.nivel + 1
    from arbol t
    join linea_maquinas lm
      on lm.linea_id = t.linea_id
     and lm.padre_maquina_id = t.maquina_id
    where t.nivel < 20
), resuelto as (
    select distinct on (a.uuid_cliente, a.maquina_id)
           a.uuid_cliente, a.linea_id, a.maquina_id, a.causa, a.origen, a.origen_id,
           a.alcance, a.hora_inicio, a.duracion_minutos, a.nivel
    from arbol a
    order by a.uuid_cliente, a.maquina_id, a.nivel
)
select r.uuid_cliente as parada_uuid,
       r.linea_id,
       r.maquina_id,
       m.nombre_corto,
       lm.posicion,
       r.causa,
       r.origen,
       r.origen_id,
       r.alcance,
       r.hora_inicio,
       r.duracion_minutos,
       (r.alcance = 'linea' or r.maquina_id <> r.origen_id) as afectada
from resuelto r
join maquinas m on m.id = r.maquina_id
left join linea_maquinas lm
       on lm.linea_id = r.linea_id and lm.maquina_id = r.maquina_id;
