-- Union Enterprises Pakistan PDF logo option, for an EXISTING Accounts installation.
-- Run once as postgres in Supabase SQL Editor. Safe to rerun.
-- Updates only the existing logo allowlist. No financial records are changed.
BEGIN;
DO $union_logo$
DECLARE
    definition text;
    old_list text := $old$('','images/haulxify.webp','images/aims.webp')$old$;
    new_list text := $new$('','images/haulxify.webp','images/aims.webp','images/Union.webp')$new$;
BEGIN
    IF to_regprocedure('portal_finance.write_resource(text,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'Accounts is not installed. For a new installation use accounts_setup.sql instead.';
    END IF;
    definition := pg_get_functiondef('portal_finance.write_resource(text,jsonb)'::regprocedure);
    IF strpos(definition, new_list) > 0 THEN
        RETURN;
    END IF;
    IF strpos(definition, old_list) = 0 THEN
        RAISE EXCEPTION 'The Accounts function differs from this codebase. No changes applied.';
    END IF;
    EXECUTE replace(definition, old_list, new_list);
END;
$union_logo$;
COMMIT;
