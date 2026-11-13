-- =====================================================================
--  023 · Cada equipo es único: los parecidos se distinguen con número
--
--  Regla del usuario: no pueden existir dos equipos con el mismo nombre;
--  cuando hay varios iguales se numeran (LINEA 1, LINEA 2…). Esto ordena
--  los que quedaron con sufijo de línea al separar Eventualidades y arregla
--  un nombre corto repetido (LIMPIEZA 2 aparecía dos veces).
-- =====================================================================

-- Las cuatro tarjetas de Eventualidades pasan a numerarse.
update maquinas m
   set nombre      = 'EVENTUALIDADES ' || v.n,
       nombre_corto = 'Eventualidades ' || v.n
  from (values (68, 1), (72, 2), (73, 3), (74, 4)) as v(id, n)
 where m.id = v.id;

-- Códigos internos prolijos, sólo si están libres.
update maquinas set codigo = 'EVENTUALIDADES-1' where id = 68
  and not exists (select 1 from maquinas x where x.codigo = 'EVENTUALIDADES-1' and x.id <> 68);
update maquinas set codigo = 'EVENTUALIDADES-2' where id = 72
  and not exists (select 1 from maquinas x where x.codigo = 'EVENTUALIDADES-2' and x.id <> 72);
update maquinas set codigo = 'EVENTUALIDADES-3' where id = 73
  and not exists (select 1 from maquinas x where x.codigo = 'EVENTUALIDADES-3' and x.id <> 73);
update maquinas set codigo = 'EVENTUALIDADES-4' where id = 74
  and not exists (select 1 from maquinas x where x.codigo = 'EVENTUALIDADES-4' and x.id <> 74);

-- LIMPIEZA 3 tenía el nombre corto «LIMPIEZA 2», igual que la 69.
update maquinas set nombre_corto = 'LIMPIEZA 3' where id = 75 and nombre_corto = 'LIMPIEZA 2';
