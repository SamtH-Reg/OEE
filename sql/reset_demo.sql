-- Deja la base vacía (sin catálogos ni datos). Uso: re-ejecutar esquema_paradas.sql después.
drop schema public cascade;
create schema public;
grant all on schema public to current_user;
