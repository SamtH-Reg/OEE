-- =====================================================================
--  031 · Usuarios, roles y PIN
--
--  Login del administrador con correo y contraseña; los operadores de la
--  tablet entran con un PIN de 4–6 dígitos. Roles: admin, supervisor,
--  operador. Las claves y los PIN se guardan con scrypt (salt:hash), nunca
--  en claro. El administrador inicial lo siembra el servidor al arrancar
--  (ADMIN_EMAIL / ADMIN_PASS, con los valores por defecto de la planta).
-- =====================================================================

create table if not exists usuarios (
    id              bigserial   primary key,
    nombre          text        not null,
    email           text        unique,
    rol             text        not null default 'operador'
                    check (rol in ('admin', 'supervisor', 'operador')),
    pass_hash       text,
    pin_hash        text,
    activo          boolean     not null default true,
    creado_en       timestamptz not null default now(),
    ultimo_acceso   timestamptz,
    intentos        integer     not null default 0,
    bloqueado_hasta timestamptz
);

create index if not exists ix_usuarios_rol on usuarios (rol) where activo;
create index if not exists ix_usuarios_email on usuarios (lower(email));
