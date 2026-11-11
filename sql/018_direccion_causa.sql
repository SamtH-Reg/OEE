-- 018 · Dirección de propagación por causa
--
-- Algunas causas paran también lo que viene ANTES en la línea: una limpieza por
-- acumulación de producto obliga a detener el proceso aguas arriba.
--   'abajo'  (por defecto): se detiene lo que sigue en el flujo
--   'arriba'             : se detiene lo que alimenta a ese bloque
--   'ambas'              : se detiene toda la rama conectada

alter table codigos_causa
    add column if not exists direccion text not null default 'abajo';

alter table codigos_causa drop constraint if exists ck_causa_direccion;
alter table codigos_causa
    add constraint ck_causa_direccion check (direccion in ('abajo', 'arriba', 'ambas'));
