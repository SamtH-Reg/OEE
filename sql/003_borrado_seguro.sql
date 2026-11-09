-- 003 · Borrado seguro
-- Dos correcciones sobre la auditoría:
--   a) el registro de auditoría de un DELETE no puede apuntar a la fila borrada
--   b) borrar una parada debe ser imposible salvo mantenimiento explícito

alter table registro_paradas_auditoria
    alter column parada_id drop not null;

create or replace function fn_auditar_parada() returns trigger
language plpgsql as $fn$
declare
    v_campos text[];
begin
    if tg_op = 'UPDATE' then
        select array_agg(n.key order by n.key) into v_campos
        from jsonb_each(to_jsonb(new)) n
        join jsonb_each(to_jsonb(old)) o on o.key = n.key
        where n.value is distinct from o.value;

        if v_campos is null then
            return new;
        end if;
    end if;

    insert into registro_paradas_auditoria (parada_id, accion, campos, anterior, nuevo, usuario)
    values (case when tg_op = 'DELETE' then null else coalesce(new.id, old.id) end,
            tg_op,
            v_campos,
            case when tg_op = 'INSERT' then null else to_jsonb(old) end,
            case when tg_op = 'DELETE' then null else to_jsonb(new) end,
            coalesce(current_setting('app.usuario', true), 'sistema'));
    return coalesce(new, old);
end $fn$;

-- Regla del dominio: una parada no se borra, se anula.
create or replace function fn_proteger_parada() returns trigger
language plpgsql as $fn$
begin
    if coalesce(current_setting('app.permitir_borrado', true), 'off') <> 'on' then
        raise exception 'Las paradas no se borran: se anulan con motivo (estado = anulada)';
    end if;
    return old;
end $fn$;

drop trigger if exists tr_paradas_proteger on registro_paradas;
create trigger tr_paradas_proteger
    before delete on registro_paradas
    for each row execute function fn_proteger_parada();
