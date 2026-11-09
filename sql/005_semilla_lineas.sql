-- 005 · Líneas de demostración y tramas
-- Cada línea es una secuencia; el cuello de botella detiene la línea completa.
-- Las tramas son disjuntas a propósito: una máquina compartida entre líneas
-- haría que una parada de L1 aparezca como parada de L3.

insert into lineas (codigo, nombre, descripcion, orden) values
  ('L1', 'Línea 1 · Merluza',   'Recepción → desviscerado → túnel 2', 1),
  ('L2', 'Línea 2 · Congelado', 'Balanza → cinta 2 → fileteadora → túnel 3', 2),
  ('L3', 'Línea 3 · Empaque',   'Detector de metales → empacadora → etiquetadora', 3)
on conflict (codigo) do nothing;

insert into linea_maquinas (linea_id, maquina_id, posicion, detiene_linea)
select l.id, m.id, v.pos, v.cuello
from (values
  ('L1', 'BOM-01', 1, false),
  ('L1', 'CIN-R1', 2, false),
  ('L1', 'DES-01', 3, true),    -- desvisceradora: cuello de botella
  ('L1', 'CIN-01', 4, false),
  ('L1', 'TUN-02', 5, false),

  ('L2', 'BAL-01', 1, false),
  ('L2', 'CIN-02', 2, false),
  ('L2', 'FIL-01', 3, true),    -- fileteadora: cuello de botella
  ('L2', 'TUN-03', 4, false),

  ('L3', 'DET-01', 1, true),    -- detector de metales: cuello de botella
  ('L3', 'EMP-01', 2, false),
  ('L3', 'ETI-01', 3, false)
) as v(linea, maquina, pos, cuello)
join lineas  l on l.codigo = v.linea
join maquinas m on m.codigo = v.maquina
on conflict (linea_id, maquina_id) do nothing;

-- Paradas históricas: se les asigna la primera línea de su máquina y alcance
-- de máquina, para no alterar los indicadores ya calculados.
update registro_paradas p
   set linea_id = (
        select lm.linea_id from linea_maquinas lm
         where lm.maquina_id = p.maquina_id
         order by lm.linea_id limit 1)
 where p.linea_id is null;

update registro_paradas set alcance = 'maquina' where alcance is null;
