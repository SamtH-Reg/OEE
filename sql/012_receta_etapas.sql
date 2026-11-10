-- 012 · Etapas del proceso (organigrama de la receta)
--
-- Una receta deja de ser «una línea + distribución» y pasa a ser un PROCESO:
-- una secuencia de etapas donde cada etapa es una máquina suelta o una línea
-- completa. Las etapas que comparten el mismo `orden` corren en paralelo
-- (dos líneas que alimentan una máquina, por ejemplo).

create table receta_etapas (
    id         integer generated always as identity primary key,
    receta_id  integer  not null references recetas(id) on delete cascade,
    orden      smallint not null,
    tipo       text     not null check (tipo in ('maquina', 'linea')),
    maquina_id integer  references maquinas(id) on delete cascade,
    linea_id   integer  references lineas(id) on delete cascade,
    etiqueta   text,
    paralelo   boolean  not null default false,
    constraint ck_etapa_destino check (
        (tipo = 'maquina' and maquina_id is not null and linea_id is null) or
        (tipo = 'linea'   and linea_id   is not null and maquina_id is null)
    )
);

create index ix_etapas_receta on receta_etapas (receta_id, orden);

create or replace view v_receta_etapas as
select e.id,
       e.receta_id,
       e.orden,
       e.tipo,
       e.maquina_id,
       e.linea_id,
       e.paralelo,
       coalesce(e.etiqueta, case when e.tipo = 'linea' then l.nombre else m.nombre_corto end) as nombre,
       l.codigo as linea_codigo,
       m.codigo as maquina_codigo
from receta_etapas e
left join maquinas m on m.id = e.maquina_id
left join lineas   l on l.id = e.linea_id
order by e.receta_id, e.orden, e.id;
