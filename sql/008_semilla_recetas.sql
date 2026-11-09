-- 008 · Semilla de especies, productos y recetas

insert into especies (codigo, nombre) values
  ('MER', 'Merluza'),
  ('SAL', 'Salmón'),
  ('JIB', 'Jibia')
on conflict (codigo) do nothing;

insert into productos (codigo, nombre, especie_id) values
  ('FIL',  'Filete',          (select id from especies where codigo = 'MER')),
  ('HG',   'H&G',             (select id from especies where codigo = 'MER')),
  ('POR',  'Porciones',       (select id from especies where codigo = 'SAL')),
  ('ALET', 'Aleta de jibia',  (select id from especies where codigo = 'JIB'))
on conflict (codigo) do nothing;

insert into recetas (codigo, nombre, especie_id, producto_id, linea_id,
                     toneladas_turno, rendimiento_pct, vigente_desde, notas)
values
  ('R-MER-FIL', 'Merluza filete · L1',
   (select id from especies where codigo = 'MER'),
   (select id from productos where codigo = 'FIL'),
   (select id from lineas  where codigo = 'L1'),
   42.00, 42.00, current_date, 'Programa base de fileteo'),
  ('R-MER-HG', 'Merluza H&G · L2',
   (select id from especies where codigo = 'MER'),
   (select id from productos where codigo = 'HG'),
   (select id from lineas  where codigo = 'L2'),
   55.00, 58.00, current_date, 'Línea de congelado'),
  ('R-SAL-POR', 'Salmón porciones · L3',
   (select id from especies where codigo = 'SAL'),
   (select id from productos where codigo = 'POR'),
   (select id from lineas  where codigo = 'L3'),
   18.00, 76.00, current_date, 'Empaque primario')
on conflict (codigo) do nothing;

-- Distribución: en L2 la fileteadora y el túnel no llevan el 100% del flujo.
insert into receta_maquinas (receta_id, maquina_id, porcentaje)
select r.id, m.id, v.pct
from (values
  ('R-MER-HG', 'BAL-01', 100),
  ('R-MER-HG', 'CIN-02', 100),
  ('R-MER-HG', 'FIL-01',  65),
  ('R-MER-HG', 'TUN-03',  35)
) as v(receta, maquina, pct)
join recetas r on r.codigo = v.receta
join maquinas m on m.codigo = v.maquina
on conflict (receta_id, maquina_id) do nothing;

insert into receta_maquinas (receta_id, maquina_id, porcentaje)
select r.id, m.id, 100
from recetas r
join linea_maquinas lm on lm.linea_id = r.linea_id
join maquinas m on m.id = lm.maquina_id
where r.codigo in ('R-MER-FIL', 'R-SAL-POR')
on conflict (receta_id, maquina_id) do nothing;
