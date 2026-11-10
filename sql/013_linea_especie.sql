-- 013 · Especie y producto por línea
--
-- La línea (o el proceso) lleva la especie y el producto que elabora, para no
-- depender de crear una receta aparte. Nullable: se puede completar después.

alter table lineas
    add column if not exists especie_id  integer references especies(id) on delete set null,
    add column if not exists producto_id integer references productos(id) on delete set null;

create index if not exists ix_lineas_especie on lineas (especie_id);
