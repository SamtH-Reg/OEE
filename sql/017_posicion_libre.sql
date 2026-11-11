-- 017 · Posición libre de cada tarjeta en el lienzo
--
-- El editor deja de ser una grilla de etapas: cada tarjeta guarda su x/y en el
-- lienzo y se puede arrastrar a cualquier lado. Si no tiene posición, se ubica
-- automáticamente por etapa/rama.

alter table linea_maquinas
    add column if not exists pos_x integer,
    add column if not exists pos_y integer;
