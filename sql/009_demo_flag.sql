-- 009 · Marca de datos de demostración
--
-- Permite que la app ofrezca «eliminar los datos de demostración» sin tocar
-- lo que el usuario cargó a mano (equipos, líneas o recetas propias).
-- Las áreas, especies y productos se conservan: son catálogos, no datos de ejemplo.

alter table areas    add column if not exists es_demo boolean not null default false;
alter table maquinas add column if not exists es_demo boolean not null default false;
alter table lineas   add column if not exists es_demo boolean not null default false;
alter table recetas  add column if not exists es_demo boolean not null default false;

-- Semilla original (códigos fijos del script 005 / 008 / esquema base).
update areas set es_demo = true
 where codigo in ('REC', 'FIL', 'CON', 'EMP');

update maquinas set es_demo = true
 where codigo in ('BAL-01','BOM-01','CIN-R1','DES-01','CIN-01','CIN-02','FIL-01',
                  'TUN-02','TUN-03','COM-01','EMP-01','ETI-01','DET-01');

update lineas set es_demo = true
 where codigo in ('L1', 'L2', 'L3');

update recetas set es_demo = true
 where codigo in ('R-MER-FIL', 'R-MER-HG', 'R-SAL-POR');

-- Resumen para el panel de administración.
create or replace view v_demo_resumen as
select
  (select count(*) from maquinas m where m.es_demo)::int                    as maquinas,
  (select count(*) from lineas l where l.es_demo)::int                      as lineas,
  (select count(*) from recetas r where r.es_demo)::int                     as recetas,
  (select count(*) from registro_paradas p
     join maquinas m on m.id = p.maquina_id and m.es_demo)::int             as paradas;

-- Borrado de la demostración: paradas -> líneas -> equipos -> recetas.
-- El trigger de protección de paradas exige habilitar el borrado explícito.
create or replace function fn_eliminar_demo()
returns table (paradas integer, recetas integer, lineas integer, maquinas integer)
language plpgsql as $fn$
declare
    v_paradas integer;
    v_recetas integer;
    v_lineas  integer;
    v_maquinas integer;
begin
    perform set_config('app.permitir_borrado', 'on', true);

    select count(*) into v_paradas from registro_paradas p
     join maquinas m on m.id = p.maquina_id and m.es_demo;
    delete from registro_paradas p
     using maquinas m
     where m.id = p.maquina_id and m.es_demo;

    select count(*) into v_recetas from recetas where es_demo;
    delete from recetas where es_demo;

    select count(*) into v_lineas from lineas where es_demo;
    delete from linea_maquinas lm using lineas l
     where l.id = lm.linea_id and l.es_demo;
    delete from lineas where es_demo;

    select count(*) into v_maquinas from maquinas where es_demo;
    delete from linea_maquinas lm using maquinas m
     where m.id = lm.maquina_id and m.es_demo;
    delete from maquinas where es_demo;

    return query select v_paradas, v_recetas, v_lineas, v_maquinas;
end $fn$;
