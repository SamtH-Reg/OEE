-- 011 · Áreas de la planta según el layout real
--
-- Se renombran las áreas existentes (conservando las máquinas asignadas) y se
-- agregan las que faltan. El código se mantiene corto porque se usa en informes.

update areas set codigo = 'MP',  nombre = 'Materias Primas',        orden = 6, es_demo = false where codigo = 'REC';
update areas set codigo = 'ZP',  nombre = 'Zona Primaria',          orden = 2, es_demo = false where codigo = 'FIL';
update areas set codigo = 'IQF', nombre = 'Túnel Continuo IQF',     orden = 4, es_demo = false where codigo = 'CON';
update areas set nombre = 'Empaque', orden = 5, es_demo = false where codigo = 'EMP';

insert into areas (codigo, nombre, orden) values
  ('CMP', 'Cámaras Materias Primas', 1),
  ('ZS',  'Zona Secundaria',         3)
on conflict (codigo) do nothing;

update areas set es_demo = false;
