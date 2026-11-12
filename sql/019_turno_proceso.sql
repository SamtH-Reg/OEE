-- 019 · Proceso del turno
--
-- Las líneas son las piezas; un proceso (receta) agrupa las líneas que se van a
-- operar en el turno. Ej.: «HG fresco + porciones» = L2 HG + L3 HG + L1 Porciones.
-- El turno guarda el proceso vigente para mapear la producción del día.

alter table turnos
    add column if not exists proceso_id integer references recetas(id) on delete set null;
