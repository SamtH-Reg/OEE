-- 006 · Tramas sin solape
-- EMP-01 y ETI-01 estaban en L1/L2 y también en L3: una parada de L1 marcaba
-- L3 como detenida. Cada máquina queda en una sola línea (la empacadora y la
-- etiquetadora viven en la línea de empaque).

delete from linea_maquinas;

insert into linea_maquinas (linea_id, maquina_id, posicion, detiene_linea)
select l.id, m.id, v.pos, v.cuello
from (values
  ('L1', 'BOM-01', 1, false),
  ('L1', 'CIN-R1', 2, false),
  ('L1', 'DES-01', 3, true),
  ('L1', 'CIN-01', 4, false),
  ('L1', 'TUN-02', 5, false),

  ('L2', 'BAL-01', 1, false),
  ('L2', 'CIN-02', 2, false),
  ('L2', 'FIL-01', 3, true),
  ('L2', 'TUN-03', 4, false),

  ('L3', 'DET-01', 1, true),
  ('L3', 'EMP-01', 2, false),
  ('L3', 'ETI-01', 3, false)
) as v(linea, maquina, pos, cuello)
join lineas  l on l.codigo = v.linea
join maquinas m on m.codigo = v.maquina
on conflict (linea_id, maquina_id) do nothing;
