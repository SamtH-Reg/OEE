-- =====================================================================
--  028 · «Fin de turno» va en Operativa
--
--  La causa se creó en la primera categoría por defecto (Mecánica), donde
--  no corresponde: es una parada operativa planificada, no una falla.
-- =====================================================================

update codigos_causa
   set categoria_id = (select id from categorias_falla where codigo = 'OPE' limit 1)
 where descripcion = 'Fin de turno'
   and categoria_id <> (select id from categorias_falla where codigo = 'OPE' limit 1);
