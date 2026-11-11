-- 016 · Conexiones (grafo) en vez de un solo padre
--
-- Permite que dos equipos alimenten al mismo bloque (nudo de recorte):
--   L3 -> TRIO 2 ---\
--                    > LINEA RECORTE
--   L2 -> TRIO 1 ---/
-- Una parada se propaga por estas flechas, no por la posición en la lista.
-- Un bloque con varias entradas solo se detiene si TODAS sus entradas están
-- detenidas (así, si cae L3, RECORTE sigue trabajando con L2).

create table if not exists linea_conexiones (
    linea_id           integer not null references lineas(id) on delete cascade,
    desde_maquina_id   integer not null references maquinas(id) on delete cascade,
    hasta_maquina_id   integer not null references maquinas(id) on delete cascade,
    primary key (linea_id, desde_maquina_id, hasta_maquina_id),
    constraint ck_conexion_distinta check (desde_maquina_id <> hasta_maquina_id)
);

create index if not exists ix_conexiones_hasta on linea_conexiones (linea_id, hasta_maquina_id);

-- Migrar el padre simple que se hubiera cargado
insert into linea_conexiones (linea_id, desde_maquina_id, hasta_maquina_id)
select linea_id, padre_maquina_id, maquina_id
from linea_maquinas
where padre_maquina_id is not null
on conflict do nothing;

-- las vistas y la FK dependen de la columna: se quitan antes y se recrean
drop view if exists v_paradas_efectivas;
drop view if exists v_maquinas_afectadas;
alter table linea_maquinas drop constraint if exists fk_trama_padre;
drop index if exists ix_trama_padre;
alter table linea_maquinas drop column if exists padre_maquina_id;

-- Afectadas por propagación, siguiendo las conexiones (descendientes).
create or replace view v_maquinas_afectadas as
with recursive activas as (
    select p.uuid_cliente, p.linea_id, p.maquina_id as origen_id, p.alcance,
           p.causa, p.hora_inicio, p.duracion_minutos, p.maquina as origen, p.maquina_id
    from v_paradas p
    where p.estado = 'activa' and p.linea_id is not null
), arbol as (
    select a.uuid_cliente, a.linea_id, a.origen_id, a.alcance, a.causa,
           a.hora_inicio, a.duracion_minutos, a.origen, a.maquina_id, 0 as nivel
    from activas a
    union all
    select t.uuid_cliente, t.linea_id, t.origen_id, t.alcance, t.causa,
           t.hora_inicio, t.duracion_minutos, t.origen, c.hasta_maquina_id, t.nivel + 1
    from arbol t
    join linea_conexiones c
      on c.linea_id = t.linea_id and c.desde_maquina_id = t.maquina_id
    where t.nivel < 20
)
select distinct on (a.uuid_cliente, a.maquina_id)
       a.uuid_cliente as parada_uuid,
       a.linea_id,
       a.maquina_id,
       m.nombre_corto,
       lm.posicion,
       a.causa,
       a.origen,
       a.origen_id,
       a.alcance,
       a.hora_inicio,
       a.duracion_minutos,
       (a.alcance = 'linea' or a.maquina_id <> a.origen_id) as afectada
from arbol a
join maquinas m on m.id = a.maquina_id
left join linea_maquinas lm on lm.linea_id = a.linea_id and lm.maquina_id = a.maquina_id
order by a.uuid_cliente, a.maquina_id, a.nivel;

-- Se recrea la vista de minutos-máquina sobre el nuevo cálculo.
create or replace view v_paradas_efectivas as
select a.linea_id,
       a.maquina_id,
       a.parada_uuid,
       a.causa,
       a.origen,
       a.alcance,
       a.hora_inicio,
       p.hora_fin,
       p.duracion_minutos,
       p.categoria,
       p.es_planificada
from v_maquinas_afectadas a
join v_paradas p on p.uuid_cliente = a.parada_uuid
where a.afectada;
