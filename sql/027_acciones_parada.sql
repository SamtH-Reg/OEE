-- =====================================================================
--  027 · Acciones sobre una parada (reparación / cambio de equipo)
--
--  Para el panel de análisis: cada parada puede llevar anotado qué se
--  hizo (reparación, cambio de equipo, ajuste…), quién y cuándo. Es el
--  registro que falta para cerrar el ciclo «registrar → analizar →
--  derivar → resolver» del programa de mejora.
-- =====================================================================

create table if not exists parada_acciones (
    id          bigserial primary key,
    parada_id   bigint      not null references registro_paradas(id) on delete cascade,
    tipo        text        not null default 'reparacion'
                check (tipo in ('reparacion', 'cambio_equipo', 'ajuste', 'otro')),
    detalle     text,
    responsable text,
    ocurrido_en timestamptz not null default now()
);

create index if not exists ix_parada_acciones_parada on parada_acciones (parada_id, ocurrido_en desc);
