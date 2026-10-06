-- Run as postgres in Supabase SQL Editor AFTER accounts_setup.sql.
-- Read-only diagnostics; no financial records or permissions are changed.

-- Expected: all ten financial tables have RLS enabled.
SELECT relname AS table_name,relrowsecurity AS rls_enabled
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND relname IN (
 'finance_settings','finance_permissions','finance_contacts','finance_accounts',
 'finance_journals','finance_journal_lines','finance_documents','finance_payments','finance_expenses','finance_audit')
ORDER BY relname;

-- Expected: direct authenticated writes are false for every table.
SELECT tablename,
 has_table_privilege('authenticated',format('public.%I',tablename),'INSERT') AS can_insert_directly,
 has_table_privilege('authenticated',format('public.%I',tablename),'UPDATE') AS can_update_directly,
 has_table_privilege('authenticated',format('public.%I',tablename),'DELETE') AS can_delete_directly
FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename LIKE 'finance_%';

-- Expected: anon false; authenticated true for this guarded public API.
SELECT has_function_privilege('anon','public.finance_api(text,jsonb)','EXECUTE') AS anon_can_call,
 has_function_privilege('authenticated','public.finance_api(text,jsonb)','EXECUTE') AS signed_in_can_call;

-- Union must resolve to the correct Auth identity, with View only unless changed by a super admin.
SELECT u.id,u.email,u.email_confirmed_at,p.role,p.is_active,p.is_approved,fp.access_level
FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id
LEFT JOIN public.finance_permissions fp ON fp.user_id=u.id
WHERE lower(u.email)='unionenterprisespakistan@gmail.com';

-- Expected: zero rows. Every posted journal must balance and have two or more lines.
SELECT j.id,count(l.id) AS line_count,sum(l.debit) AS debit,sum(l.credit) AS credit
FROM public.finance_journals j LEFT JOIN public.finance_journal_lines l ON l.journal_id=j.id
GROUP BY j.id HAVING count(l.id)<2 OR coalesce(sum(l.debit-l.credit),0)<>0;

-- Expected: zero rows. No document is overpaid or has unmatched base carrying values.
SELECT d.id,d.number,d.total,sum(p.amount) AS paid,d.base_total,sum(p.base_carry) AS base_paid
FROM public.finance_documents d JOIN public.finance_payments p ON p.document_id=d.id AND p.reversed_at IS NULL
GROUP BY d.id HAVING sum(p.amount)>d.total OR sum(p.base_carry)>d.base_total;

-- Current trial balance: total debits and credits must agree.
SELECT coalesce(sum(debit),0) AS debits,coalesce(sum(credit),0) AS credits,
 coalesce(sum(debit-credit),0) AS difference FROM public.finance_journal_lines;

-- Views must show security_invoker=true.
SELECT c.relname,c.reloptions FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('finance_document_view','finance_expense_view','finance_ledger_view');
