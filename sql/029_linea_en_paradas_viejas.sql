-- =====================================================================
--  029 · Paradas viejas sin línea
--
--  Las paradas registradas antes de que existiera el armado por líneas
--  quedaron con linea_id en null y el análisis las muestra como «sin
--  línea». Se les asigna la primera línea de su equipo.
-- =====================================================================

update registro_paradas p
   set linea_id = (
         select lm.linea_id from linea_maquinas lm
          where lm.maquina_id = p.maquina_id
          order by lm.linea_id limit 1)
 where p.linea_id is null
   and exists (select 1 from linea_maquinas lm where lm.maquina_id = p.maquina_id);
