-- 007 · Administración: especies, productos y recetas
--
-- Una receta es la configuración de producción: qué especie y producto se
-- elaboran, en qué línea, con cuántas toneladas planificadas y cómo se
-- distribuye el flujo entre las máquinas de esa línea.

create table especies (
    id        integer generated always as identity primary key,
    codigo    text    not null unique,          -- 'MER', 'SAL'
    nombre    text    not null,
    activa    boolean not null default true
);

create table productos (
    id         integer generated always as identity primary key,
    codigo     text    not null unique,          -- 'FIL', 'HG'
    nombre     text    not null,
    especie_id integer references especies(id) on delete set null,
    activo     boolean not null default true
);

create table recetas (
    id               integer generated always as identity primary key,
    codigo           text    not null unique,    -- 'R-MER-FIL'
    nombre           text    not null,
    especie_id       integer references especies(id) on delete set null,
    producto_id      integer references productos(id) on delete set null,
    linea_id         integer references lineas(id) on delete set null,
    toneladas_turno  numeric(10,2) check (toneladas_turno >= 0),
    rendimiento_pct  numeric(5,2)  check (rendimiento_pct > 0 and rendimiento_pct <= 100),
    vigente_desde    date,
    vigente_hasta    date,
    activa           boolean not null default true,
    notas            text,
    creado_en        timestamptz not null default now(),
    actualizado_en   timestamptz not null default now(),
    constraint ck_vigencia check (vigente_hasta is null or vigente_desde is null or vigente_hasta >= vigente_desde)
);

-- Distribución del flujo entre las máquinas de la línea (ej. 60% / 40%).
create table receta_maquinas (
    receta_id  integer not null references recetas(id) on delete cascade,
    maquina_id integer not null references maquinas(id) on delete cascade,
    porcentaje numeric(5,2) not null default 100
               check (porcentaje > 0 and porcentaje <= 100),
    primary key (receta_id, maquina_id)
);

create index ix_recetas_linea on recetas (linea_id, activa);

create or replace function fn_touch_receta() returns trigger
language plpgsql as $fn$
begin
    new.actualizado_en := now();
    return new;
end $fn$;

drop trigger if exists tr_recetas_touch on recetas;
create trigger tr_recetas_touch
    before update on recetas
    for each row execute function fn_touch_receta();

-- Lectura para el panel de administración.
create or replace view v_recetas as
select r.id, r.codigo, r.nombre,
       r.especie_id, e.nombre as especie,
       r.producto_id, p.nombre as producto,
       r.linea_id, l.codigo as linea_codigo, l.nombre as linea,
       r.toneladas_turno, r.rendimiento_pct,
       r.vigente_desde, r.vigente_hasta, r.activa, r.notas,
       (select count(*) from receta_maquinas rm where rm.receta_id = r.id)::int as maquinas
from recetas r
left join especies e on e.id = r.especie_id
left join productos p on p.id = r.producto_id
left join lineas   l on l.id = r.linea_id
order by r.codigo;
