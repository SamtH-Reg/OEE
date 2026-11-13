-- =====================================================================
--  022 · «fin de línea»: la última tarjeta de la trama
--
--  Igual que el cuello de botella, pero para el otro extremo: marca el
--  bloque que termina el proceso. No necesita conexión de salida (el aviso
--  de «no alimenta a ningún bloque» lo ignora) y el tablero puede saber
--  dónde termina la línea. Es un atributo de la trama, no del equipo.
-- =====================================================================

alter table linea_maquinas
    add column if not exists fin_linea boolean not null default false;

comment on column linea_maquinas.fin_linea is
    'Última tarjeta del proceso: puede no tener salidas';
