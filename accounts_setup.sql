-- HAULXIFY PARTNER PORTAL — Accounts & Billing, version 1
-- Additive installer: run on your EXISTING Supabase project, as postgres.
-- Back up first. Do not rerun the original setup.sql on an existing project.
-- The installer is transactional and safe to rerun; existing financial data stays.
BEGIN;

CREATE SCHEMA IF NOT EXISTS portal_finance;
REVOKE ALL ON SCHEMA portal_finance FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA portal_finance TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA portal_finance REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE IF NOT EXISTS public.finance_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  business_name text NOT NULL DEFAULT 'HAULXIFY',
  address text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
  tax_id text NOT NULL DEFAULT '', logo_path text NOT NULL DEFAULT 'images/haulxify.webp',
  base_currency text NOT NULL DEFAULT 'PKR' CHECK (base_currency IN ('PKR','USD')),
  timezone text NOT NULL DEFAULT 'Asia/Karachi',
  invoice_prefix text NOT NULL DEFAULT 'INV', bill_prefix text NOT NULL DEFAULT 'BILL',
  payment_details text NOT NULL DEFAULT '', default_terms text NOT NULL DEFAULT 'Thank you for your business.',
  closed_through date, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.finance_settings(id) VALUES(true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.finance_permissions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_level text NOT NULL CHECK (access_level IN ('none','view','edit')),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Match the actual Auth identity, never an editable profile email or user_metadata.
INSERT INTO public.finance_permissions(user_id, access_level)
SELECT id,'view' FROM auth.users WHERE lower(email)='unionenterprisespakistan@gmail.com'
ON CONFLICT(user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.finance_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  contact_type text NOT NULL CHECK (contact_type IN ('client','supplier','both')),
  email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '',
  tax_id text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  is_cash boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  system_key text UNIQUE,
  CHECK (NOT is_cash OR account_type='asset')
);
INSERT INTO public.finance_accounts(code,name,account_type,is_cash,system_key) VALUES
 ('1000','Cash on hand','asset',true,'cash'),('1010','Business bank','asset',true,'bank'),
 ('1100','Accounts receivable','asset',false,'receivable'),('1200','Recoverable tax','asset',false,'tax_receivable'),
 ('1500','Equipment & fixed assets','asset',false,'fixed_assets'),
 ('2000','Accounts payable','liability',false,'payable'),('2100','Tax payable','liability',false,'tax_payable'),
 ('2200','Loans payable','liability',false,'loans'),
 ('3000','Owner capital','equity',false,'capital'),('3100','Owner drawings','equity',false,'drawings'),
 ('3200','Opening balance equity','equity',false,'opening_equity'),('3300','Retained earnings','equity',false,'retained'),
 ('4000','Service revenue','income',false,'revenue'),('4100','Other income','income',false,'other_income'),
 ('4200','Foreign exchange gains','income',false,'fx_gain'),
 ('5000','Salaries & wages','expense',false,'salary'),('5010','Rent','expense',false,'rent'),
 ('5020','Utilities','expense',false,'utilities'),('5030','Fuel & transport','expense',false,'fuel'),
 ('5040','Marketing & advertising','expense',false,'marketing'),('5050','Software & subscriptions','expense',false,'software'),
 ('5060','Office supplies','expense',false,'office'),('5070','Travel & meals','expense',false,'travel'),
 ('5080','Repairs & maintenance','expense',false,'repairs'),('5090','Bank charges','expense',false,'bank_fees'),
 ('5100','Other expenses','expense',false,'other_expense'),('5200','Foreign exchange losses','expense',false,'fx_loss')
 ON CONFLICT(code) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS portal_finance.invoice_number;
CREATE SEQUENCE IF NOT EXISTS portal_finance.bill_number;
CREATE TABLE IF NOT EXISTS public.finance_journals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entry_date date NOT NULL,
 description text NOT NULL, source_type text NOT NULL, source_id uuid,
 reversal_of uuid UNIQUE REFERENCES public.finance_journals(id),
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_journal_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 journal_id uuid NOT NULL REFERENCES public.finance_journals(id),
 account_id uuid NOT NULL REFERENCES public.finance_accounts(id),
 debit numeric(16,2) NOT NULL DEFAULT 0, credit numeric(16,2) NOT NULL DEFAULT 0,
 CHECK ((debit>0 AND credit=0) OR (credit>0 AND debit=0))
);
CREATE TABLE IF NOT EXISTS public.finance_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('invoice','bill')),
 number text UNIQUE, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','issued','void')),
 contact_id uuid NOT NULL REFERENCES public.finance_contacts(id),
 issue_date date NOT NULL, due_date date NOT NULL, CHECK(due_date>=issue_date),
 currency text NOT NULL CHECK(currency IN ('PKR','USD')), exchange_rate numeric(18,8) NOT NULL CHECK(exchange_rate>0),
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)>0),
 subtotal numeric(16,2) NOT NULL CHECK(subtotal>=0), discount_total numeric(16,2) NOT NULL CHECK(discount_total>=0),
 tax_total numeric(16,2) NOT NULL CHECK(tax_total>=0), total numeric(16,2) NOT NULL CHECK(total>0),
 base_total numeric(16,2) NOT NULL CHECK(base_total>0),
 is_opening boolean NOT NULL DEFAULT false, reference text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 issuer_snapshot jsonb NOT NULL, contact_snapshot jsonb NOT NULL,
 journal_id uuid REFERENCES public.finance_journals(id),
 version integer NOT NULL DEFAULT 1, void_reason text, void_date date,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES public.finance_documents(id),
 cash_account_id uuid NOT NULL REFERENCES public.finance_accounts(id), payment_date date NOT NULL,
 amount numeric(16,2) NOT NULL CHECK(amount>0), exchange_rate numeric(18,8) NOT NULL CHECK(exchange_rate>0),
 base_cash numeric(16,2) NOT NULL CHECK(base_cash>0), base_carry numeric(16,2) NOT NULL CHECK(base_carry>0),
 reference text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 journal_id uuid NOT NULL REFERENCES public.finance_journals(id),
 reversed_at timestamptz, reversal_date date, reversal_reason text,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expense_date date NOT NULL,
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),
 category_id uuid NOT NULL REFERENCES public.finance_accounts(id),
 cash_account_id uuid NOT NULL REFERENCES public.finance_accounts(id),
 contact_id uuid REFERENCES public.finance_contacts(id),
 currency text NOT NULL CHECK(currency IN ('PKR','USD')), exchange_rate numeric(18,8) NOT NULL CHECK(exchange_rate>0),
 amount numeric(16,2) NOT NULL CHECK(amount>0), base_amount numeric(16,2) NOT NULL CHECK(base_amount>0),
 reference text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 state text NOT NULL DEFAULT 'posted' CHECK(state IN ('posted','void')),
 journal_id uuid NOT NULL REFERENCES public.finance_journals(id), void_date date, void_reason text,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.finance_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, action text NOT NULL,
 entity_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS portal_finance.requests (
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, request_id uuid NOT NULL,
 payload_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_id)
);
CREATE INDEX IF NOT EXISTS finance_docs_kind_date ON public.finance_documents(kind,issue_date DESC,id);
CREATE INDEX IF NOT EXISTS finance_docs_contact ON public.finance_documents(contact_id);
CREATE INDEX IF NOT EXISTS finance_payments_doc ON public.finance_payments(document_id);
CREATE INDEX IF NOT EXISTS finance_payments_cash ON public.finance_payments(cash_account_id);
CREATE INDEX IF NOT EXISTS finance_expenses_date ON public.finance_expenses(expense_date DESC,id);
CREATE INDEX IF NOT EXISTS finance_expenses_category ON public.finance_expenses(category_id,expense_date);
CREATE INDEX IF NOT EXISTS finance_expenses_cash ON public.finance_expenses(cash_account_id);
CREATE INDEX IF NOT EXISTS finance_expenses_contact ON public.finance_expenses(contact_id);
CREATE INDEX IF NOT EXISTS finance_journals_date ON public.finance_journals(entry_date,id);
CREATE INDEX IF NOT EXISTS finance_lines_journal ON public.finance_journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS finance_lines_account ON public.finance_journal_lines(account_id,journal_id);
CREATE INDEX IF NOT EXISTS finance_audit_date ON public.finance_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS finance_audit_actor ON public.finance_audit(actor_id);

-- Helpers live in a schema which MUST NOT be added to Supabase's exposed schemas.
CREATE OR REPLACE FUNCTION portal_finance.is_super_admin() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
 AND p.role='super_admin' AND p.is_active AND coalesce(p.is_approved,true));
$$;
CREATE OR REPLACE FUNCTION portal_finance.access_level() RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
   WHERE p.id=auth.uid() AND p.is_active AND coalesce(p.is_approved,true) AND u.email_confirmed_at IS NOT NULL)
 THEN 'none' WHEN portal_finance.is_super_admin() THEN 'admin'
 ELSE coalesce((SELECT access_level FROM public.finance_permissions WHERE user_id=auth.uid()),'none') END;
$$;
CREATE OR REPLACE FUNCTION portal_finance.require_access(p_edit boolean DEFAULT false) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text:=portal_finance.access_level();
BEGIN
 IF auth.uid() IS NULL OR v='none' OR (p_edit AND v NOT IN ('admin','edit')) THEN
   RAISE EXCEPTION 'You do not have permission to perform this accounts action.' USING ERRCODE='42501';
 END IF;
END; $$;
-- Profiles may contain newer fields absent from the uploaded original setup.sql.
-- This trigger leaves those fields alone, while protecting authorization fields.
CREATE OR REPLACE FUNCTION portal_finance.guard_profile() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_backend boolean:=coalesce(auth.jwt()->>'role','')='service_role'
 OR (auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin','supabase_auth_admin')
     AND coalesce(auth.jwt()->>'role','') NOT IN ('authenticated','anon'));
BEGIN
 IF v_backend OR portal_finance.is_super_admin() THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.role IN ('admin','super_admin') THEN RAISE EXCEPTION 'Only a super admin can assign privileged roles.' USING ERRCODE='42501'; END IF;
 ELSE
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.email IS DISTINCT FROM OLD.email
    OR NEW.role IS DISTINCT FROM OLD.role OR NEW.company IS DISTINCT FROM OLD.company
    OR NEW.is_approved IS DISTINCT FROM OLD.is_approved OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      -- Preserve the existing admin submission flow: it may only mark a new,
      -- lower-privilege employee pending approval, never activate/promote one.
      IF NOT (EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active)
        AND OLD.role IN ('sales_agent','status_updater') AND NEW.role=OLD.role
        AND NEW.id=OLD.id AND NEW.email=OLD.email AND NEW.created_at=OLD.created_at
        AND NEW.is_active=false AND NEW.is_approved=false AND NEW.approved_by=auth.uid()
        AND NEW.company='AIMS Logistics') THEN
        RAISE EXCEPTION 'Only a super admin can change account permissions or approval.' USING ERRCODE='42501';
      END IF;
   END IF;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS finance_guard_profile ON public.profiles;
CREATE TRIGGER finance_guard_profile BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION portal_finance.guard_profile();

-- Never create privileged profiles from user-editable signup metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text:=NEW.raw_app_meta_data->>'role';
BEGIN
 IF v_role IS NULL OR v_role NOT IN ('super_admin','admin','sales_agent','status_updater') THEN
   v_role:=CASE WHEN NEW.raw_user_meta_data->>'role'='status_updater' THEN 'status_updater' ELSE 'sales_agent' END;
 END IF;
 INSERT INTO public.profiles(id,email,full_name,role)
 VALUES(NEW.id,NEW.email,coalesce(NEW.raw_user_meta_data->>'full_name','New User'),v_role)
 ON CONFLICT(id) DO NOTHING;
 RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION portal_finance.today() RETURNS date
 LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (now() AT TIME ZONE timezone)::date FROM public.finance_settings WHERE id;
$$;
CREATE OR REPLACE FUNCTION portal_finance.check_date(p_date date) RETURNS void
 LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF p_date IS NULL OR p_date>portal_finance.today() THEN RAISE EXCEPTION 'Posting date must be today or earlier.'; END IF;
 IF EXISTS(SELECT 1 FROM public.finance_settings WHERE id AND closed_through>=p_date) THEN
  RAISE EXCEPTION 'This accounting period is locked. Choose an open posting date.';
 END IF;
END; $$;
CREATE OR REPLACE FUNCTION portal_finance.decimal_value(p_text text,p_scale int DEFAULT 2) RETURNS numeric
 LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v numeric;
BEGIN
 IF p_text IS NULL OR p_text !~ '^[0-9]+(\.[0-9]+)?$' OR length(p_text)>26 THEN
  RAISE EXCEPTION 'Enter a valid non-negative decimal amount.';
 END IF;
 v:=p_text::numeric;
 IF v<>round(v,p_scale) OR v>999999999999.99 THEN RAISE EXCEPTION 'Amount has too many decimal places or is too large.'; END IF;
 RETURN v;
END; $$;
CREATE OR REPLACE FUNCTION portal_finance.account(p_key text) RETURNS uuid
 LANGUAGE sql STABLE SET search_path='' AS $$ SELECT id FROM public.finance_accounts WHERE system_key=p_key; $$;
CREATE OR REPLACE FUNCTION portal_finance.line(p_account uuid,p_debit numeric,p_credit numeric) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('account_id',p_account,'debit',p_debit,'credit',p_credit);
$$;
CREATE OR REPLACE FUNCTION portal_finance.audit(p_action text,p_id uuid,p_details jsonb DEFAULT '{}') RETURNS void
 LANGUAGE sql SET search_path='' AS $$
 INSERT INTO public.finance_audit(actor_id,action,entity_id,details) VALUES(auth.uid(),p_action,p_id,p_details);
$$;
CREATE OR REPLACE FUNCTION portal_finance.immutable_entry() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_TABLE_NAME='finance_journals' AND TG_OP='UPDATE' THEN
  IF NEW.created_by IS NULL AND (to_jsonb(NEW)-'created_by')=(to_jsonb(OLD)-'created_by') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Posted ledger entries are immutable. Create a reversal instead.';
 END; $$;
DROP TRIGGER IF EXISTS finance_journals_immutable ON public.finance_journals;
CREATE TRIGGER finance_journals_immutable BEFORE UPDATE OR DELETE ON public.finance_journals
 FOR EACH ROW EXECUTE FUNCTION portal_finance.immutable_entry();
DROP TRIGGER IF EXISTS finance_lines_immutable ON public.finance_journal_lines;
CREATE TRIGGER finance_lines_immutable BEFORE UPDATE OR DELETE ON public.finance_journal_lines
 FOR EACH ROW EXECUTE FUNCTION portal_finance.immutable_entry();
CREATE OR REPLACE FUNCTION portal_finance.check_balance() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_id uuid; v_count int; v_balance numeric;
BEGIN
 IF TG_TABLE_NAME='finance_journals' THEN v_id:=NEW.id; ELSE v_id:=NEW.journal_id; END IF;
 SELECT count(*),coalesce(sum(debit-credit),0) INTO v_count,v_balance FROM public.finance_journal_lines WHERE journal_id=v_id;
 IF v_count<2 OR v_balance<>0 THEN RAISE EXCEPTION 'Ledger entry must contain at least two lines and balance exactly.'; END IF;
 RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS finance_header_balanced ON public.finance_journals;
CREATE CONSTRAINT TRIGGER finance_header_balanced AFTER INSERT ON public.finance_journals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal_finance.check_balance();
DROP TRIGGER IF EXISTS finance_lines_balanced ON public.finance_journal_lines;
CREATE CONSTRAINT TRIGGER finance_lines_balanced AFTER INSERT ON public.finance_journal_lines
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION portal_finance.check_balance();

CREATE OR REPLACE FUNCTION portal_finance.post(p_date date,p_description text,p_source text,p_source_id uuid,p_lines jsonb,p_reversal uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_id uuid; r jsonb; a uuid; d numeric; c numeric; balance numeric:=0; n int:=0;
BEGIN
 PERFORM portal_finance.check_date(p_date);
 IF length(trim(p_description)) NOT BETWEEN 1 AND 500 OR jsonb_typeof(p_lines)<>'array' THEN RAISE EXCEPTION 'Invalid ledger entry.'; END IF;
 INSERT INTO public.finance_journals(entry_date,description,source_type,source_id,reversal_of,created_by)
 VALUES(p_date,p_description,p_source,p_source_id,p_reversal,auth.uid()) RETURNING id INTO v_id;
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  a:=(r->>'account_id')::uuid; d:=portal_finance.decimal_value(coalesce(r->>'debit','0')); c:=portal_finance.decimal_value(coalesce(r->>'credit','0'));
  IF d=0 AND c=0 THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.finance_accounts WHERE id=a AND (is_active OR p_reversal IS NOT NULL)) THEN RAISE EXCEPTION 'Ledger account is unavailable.'; END IF;
  INSERT INTO public.finance_journal_lines(journal_id,account_id,debit,credit) VALUES(v_id,a,d,c);
  balance:=balance+d-c; n:=n+1;
 END LOOP;
 IF n<2 OR balance<>0 THEN RAISE EXCEPTION 'Ledger debits and credits must balance exactly.'; END IF;
 RETURN v_id;
END; $$;
CREATE OR REPLACE FUNCTION portal_finance.reverse(p_journal uuid,p_date date,p_reason text) RETURNS uuid
 LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v public.finance_journals; lines jsonb;
BEGIN
 SELECT * INTO v FROM public.finance_journals WHERE id=p_journal;
 IF NOT FOUND OR v.reversal_of IS NOT NULL OR EXISTS(SELECT 1 FROM public.finance_journals WHERE reversal_of=p_journal) THEN RAISE EXCEPTION 'Entry is missing or already reversed.'; END IF;
 IF length(trim(coalesce(p_reason,'')))<3 OR p_date<v.entry_date THEN RAISE EXCEPTION 'A reason and a reversal date on/after the original date are required.'; END IF;
 SELECT jsonb_agg(portal_finance.line(account_id,credit,debit)) INTO lines FROM public.finance_journal_lines WHERE journal_id=p_journal;
 RETURN portal_finance.post(p_date,left('Reversal: '||p_reason,500),'reversal',v.source_id,lines,p_journal);
END; $$;

-- Read views obey the underlying tables' RLS (PostgreSQL 15+).
CREATE OR REPLACE VIEW public.finance_document_view WITH (security_invoker=true) AS
SELECT d.*, coalesce(p.paid,0)::numeric(16,2) AS amount_paid,
 (CASE WHEN d.state='void' THEN 0 ELSE greatest(d.total-coalesce(p.paid,0),0) END)::numeric(16,2) AS outstanding,
 CASE WHEN d.state IN ('draft','void') THEN d.state
      WHEN coalesce(p.paid,0)>=d.total THEN 'paid'
      WHEN coalesce(p.paid,0)>0 THEN 'partial'
      WHEN d.due_date<portal_finance.today() THEN 'overdue' ELSE 'unpaid' END AS status,
 (d.state='issued' AND d.due_date<portal_finance.today() AND coalesce(p.paid,0)<d.total) AS is_overdue,
 d.contact_snapshot->>'name' AS contact_name,
 (CASE WHEN d.state='void' THEN 0 ELSE greatest(d.base_total-coalesce(p.carried,0),0) END)::numeric(16,2) AS base_outstanding
FROM public.finance_documents d LEFT JOIN LATERAL (
 SELECT sum(amount) AS paid,sum(base_carry) AS carried FROM public.finance_payments WHERE document_id=d.id AND reversed_at IS NULL
) p ON true;

CREATE OR REPLACE VIEW public.finance_expense_view WITH (security_invoker=true) AS
SELECT e.*, a.name AS category_name, c.name AS cash_name, coalesce(p.name,'') AS contact_name
FROM public.finance_expenses e JOIN public.finance_accounts a ON a.id=e.category_id
JOIN public.finance_accounts c ON c.id=e.cash_account_id LEFT JOIN public.finance_contacts p ON p.id=e.contact_id;

CREATE OR REPLACE VIEW public.finance_ledger_view WITH (security_invoker=true) AS
SELECT l.*, j.entry_date, j.description, j.source_type, j.source_id, j.reversal_of,j.created_at,
 a.code AS account_code, a.name AS account_name,a.account_type,a.is_cash,
 EXISTS(SELECT 1 FROM public.finance_journals r WHERE r.reversal_of=j.id) AS is_reversed
FROM public.finance_journal_lines l JOIN public.finance_journals j ON j.id=l.journal_id
JOIN public.finance_accounts a ON a.id=l.account_id;

CREATE OR REPLACE FUNCTION portal_finance.issue_document(p_id uuid,p_version int) RETURNS jsonb
 LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d public.finance_documents; s public.finance_settings; a uuid; items jsonb:='[]';
 r jsonb; running numeric:=0; previous numeric:=0; part numeric; base_net numeric; tax numeric; jid uuid; num text; serial_number bigint;
BEGIN
 SELECT * INTO d FROM public.finance_documents WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR d.state<>'draft' THEN RAISE EXCEPTION 'Only an existing draft can be issued.'; END IF;
 IF p_version IS DISTINCT FROM d.version THEN RAISE EXCEPTION 'This draft changed in another tab. Refresh it before saving.'; END IF;
 SELECT * INTO s FROM public.finance_settings WHERE id;
 PERFORM portal_finance.check_date(d.issue_date);
 IF NOT EXISTS(SELECT 1 FROM public.finance_contacts WHERE id=d.contact_id AND is_active) THEN RAISE EXCEPTION 'Reactivate this contact before issuing a document.'; END IF;
 LOOP
  serial_number:=CASE WHEN d.kind='invoice' THEN nextval('portal_finance.invoice_number') ELSE nextval('portal_finance.bill_number') END;
  num:=CASE WHEN d.kind='invoice' THEN s.invoice_prefix ELSE s.bill_prefix END||'-'||extract(year FROM d.issue_date)::int||'-'||
   lpad(serial_number::text,greatest(7,length(serial_number::text)),'0');
  EXIT WHEN NOT EXISTS(SELECT 1 FROM public.finance_documents WHERE number=num);
 END LOOP;
 IF d.is_opening THEN
  items:=CASE WHEN d.kind='invoice' THEN jsonb_build_array(
   portal_finance.line(portal_finance.account('receivable'),d.base_total,0),portal_finance.line(portal_finance.account('opening_equity'),0,d.base_total))
  ELSE jsonb_build_array(portal_finance.line(portal_finance.account('opening_equity'),d.base_total,0),portal_finance.line(portal_finance.account('payable'),0,d.base_total)) END;
 ELSE
  FOR r IN SELECT value FROM jsonb_array_elements(d.items) LOOP
   a:=(r->>'account_id')::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.finance_accounts WHERE id=a AND is_active
     AND (account_type=CASE WHEN d.kind='invoice' THEN 'income' ELSE 'expense' END OR (d.kind='bill' AND account_type='asset' AND NOT is_cash AND coalesce(system_key,'') NOT IN ('receivable','tax_receivable')))) THEN
    RAISE EXCEPTION 'A document line uses an unavailable account.';
   END IF;
   running:=running+(r->>'net')::numeric; part:=round(running*d.exchange_rate,2)-previous; previous:=round(running*d.exchange_rate,2);
   IF part>0 THEN items:=items||jsonb_build_array(CASE WHEN d.kind='invoice' THEN portal_finance.line(a,0,part) ELSE portal_finance.line(a,part,0) END); END IF;
  END LOOP;
  base_net:=previous; tax:=d.base_total-base_net;
  IF tax>0 THEN items:=items||jsonb_build_array(CASE WHEN d.kind='invoice' THEN portal_finance.line(portal_finance.account('tax_payable'),0,tax) ELSE portal_finance.line(portal_finance.account('tax_receivable'),tax,0) END); END IF;
  items:=items||jsonb_build_array(CASE WHEN d.kind='invoice' THEN portal_finance.line(portal_finance.account('receivable'),d.base_total,0) ELSE portal_finance.line(portal_finance.account('payable'),0,d.base_total) END);
 END IF;
 jid:=portal_finance.post(d.issue_date,num||' — '||(d.contact_snapshot->>'name'),d.kind,d.id,items);
 UPDATE public.finance_documents SET state='issued',number=num,journal_id=jid,issuer_snapshot=to_jsonb(s),
  contact_snapshot=(SELECT to_jsonb(c) FROM public.finance_contacts c WHERE c.id=d.contact_id),version=version+1,updated_at=now() WHERE id=d.id;
 PERFORM portal_finance.audit('issue_'||d.kind,d.id,jsonb_build_object('number',num,'base_total',d.base_total));
 RETURN jsonb_build_object('id',d.id,'number',num);
END; $$;

CREATE OR REPLACE FUNCTION portal_finance.save_document(p jsonb) RETURNS jsonb
 LANGUAGE plpgsql SET search_path='' AS $$
<<save_document>>
DECLARE doc_id uuid; d public.finance_documents; s public.finance_settings; c public.finance_contacts;
 kind text:=p->>'kind'; cur text:=p->>'currency'; fx numeric; r jsonb; a public.finance_accounts;
 qty numeric; rate numeric; discount numeric; tax_rate numeric; gross numeric; off numeric; net numeric; tax numeric;
 subtotal numeric:=0; total_discount numeric:=0; total_tax numeric:=0; total numeric:=0; normalized jsonb:='[]';
 issue date:=(p->>'issue_date')::date; due date:=(p->>'due_date')::date; ver int; answer jsonb;
BEGIN
 SELECT * INTO s FROM public.finance_settings fs WHERE fs.id;
 IF kind IS NULL OR kind NOT IN ('invoice','bill') OR cur IS NULL OR cur NOT IN ('PKR','USD') THEN RAISE EXCEPTION 'Choose a valid document type and currency.'; END IF;
 fx:=portal_finance.decimal_value(p->>'exchange_rate',8);
 IF fx<=0 OR (cur=s.base_currency AND fx<>1) THEN RAISE EXCEPTION 'Use a positive exchange rate, or 1 for the base currency.'; END IF;
 IF issue IS NULL OR due IS NULL OR due<issue THEN RAISE EXCEPTION 'Due date must be on/after the document date.'; END IF;
 SELECT * INTO c FROM public.finance_contacts WHERE id=(p->>'contact_id')::uuid AND is_active;
 IF NOT FOUND OR c.contact_type NOT IN ('both',CASE WHEN kind='invoice' THEN 'client' ELSE 'supplier' END) THEN RAISE EXCEPTION 'Choose an active client or supplier appropriate for this document.'; END IF;
 IF jsonb_typeof(p->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Add between 1 and 200 document lines.'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p->'items') LOOP
  IF length(trim(coalesce(r->>'description',''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Every line needs a description (maximum 500 characters).'; END IF;
  qty:=portal_finance.decimal_value(r->>'quantity',3); rate:=portal_finance.decimal_value(r->>'rate');
  discount:=portal_finance.decimal_value(coalesce(r->>'discount_pct','0'),3); tax_rate:=portal_finance.decimal_value(coalesce(r->>'tax_pct','0'),3);
  IF qty<=0 OR discount>100 OR tax_rate>100 THEN RAISE EXCEPTION 'Quantity must be positive; percentages must be between 0 and 100.'; END IF;
  SELECT * INTO a FROM public.finance_accounts WHERE id=(r->>'account_id')::uuid AND is_active;
  IF NOT FOUND OR NOT (a.account_type=CASE WHEN kind='invoice' THEN 'income' ELSE 'expense' END OR
   (kind='bill' AND a.account_type='asset' AND NOT a.is_cash AND coalesce(a.system_key,'') NOT IN ('receivable','tax_receivable'))) THEN RAISE EXCEPTION 'Choose a valid income, expense, or fixed asset account for each line.'; END IF;
  gross:=round(qty*rate,2); off:=round(gross*discount/100,2); net:=gross-off; tax:=round(net*tax_rate/100,2);
  subtotal:=subtotal+gross; total_discount:=total_discount+off; total_tax:=total_tax+tax; total:=total+net+tax;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('description',trim(r->>'description'),'account_id',a.id,
   'account_name',a.name,'quantity',qty,'rate',rate,'discount_pct',discount,'tax_pct',tax_rate,'gross',gross,'discount',off,'net',net,'tax',tax,'total',net+tax));
 END LOOP;
 IF total<=0 OR round(total*fx,2)<=0 THEN RAISE EXCEPTION 'Document total must be greater than zero in both currencies.'; END IF;
 IF nullif(p->>'id','') IS NOT NULL THEN
  doc_id:=(p->>'id')::uuid; SELECT * INTO d FROM public.finance_documents WHERE finance_documents.id=save_document.doc_id FOR UPDATE;
  IF NOT FOUND OR d.state<>'draft' OR d.kind<>kind THEN RAISE EXCEPTION 'Only an existing draft can be edited.'; END IF;
  IF (p->>'version')::int IS DISTINCT FROM d.version THEN RAISE EXCEPTION 'This draft changed in another tab. Refresh it before saving.'; END IF;
  UPDATE public.finance_documents SET contact_id=c.id,issue_date=issue,due_date=due,currency=cur,exchange_rate=fx,items=normalized,
   subtotal=save_document.subtotal,discount_total=total_discount,tax_total=total_tax,total=save_document.total,base_total=round(save_document.total*fx,2),
   is_opening=coalesce((p->>'is_opening')::boolean,false),reference=left(coalesce(p->>'reference',''),200),notes=left(coalesce(p->>'notes',''),4000),
   issuer_snapshot=to_jsonb(s),contact_snapshot=to_jsonb(c),version=version+1,updated_at=now()
   WHERE finance_documents.id=save_document.doc_id RETURNING version INTO ver;
 ELSE
  INSERT INTO public.finance_documents(kind,contact_id,issue_date,due_date,currency,exchange_rate,items,subtotal,discount_total,tax_total,total,base_total,is_opening,reference,notes,issuer_snapshot,contact_snapshot,created_by)
  VALUES(kind,c.id,issue,due,cur,fx,normalized,subtotal,total_discount,total_tax,total,round(total*fx,2),coalesce((p->>'is_opening')::boolean,false),
   left(coalesce(p->>'reference',''),200),left(coalesce(p->>'notes',s.default_terms),4000),to_jsonb(s),to_jsonb(c),auth.uid()) RETURNING finance_documents.id,version INTO doc_id,ver;
 END IF;
 PERFORM portal_finance.audit('save_'||kind,doc_id,jsonb_build_object('total',total,'version',ver));
 answer:=jsonb_build_object('id',doc_id,'version',ver);
 IF coalesce((p->>'issue_now')::boolean,false) THEN answer:=portal_finance.issue_document(doc_id,ver); END IF;
 RETURN answer;
END; $$;

CREATE OR REPLACE FUNCTION portal_finance.add_payment(p jsonb) RETURNS jsonb
 LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d public.finance_documents; cash uuid:=(p->>'cash_account_id')::uuid; paid numeric; carried numeric;
 amount numeric:=portal_finance.decimal_value(p->>'amount'); fx numeric:=portal_finance.decimal_value(p->>'exchange_rate',8);
 actual numeric; carry numeric; delta numeric; lines jsonb; jid uuid; pid uuid:=gen_random_uuid(); dt date:=(p->>'payment_date')::date;
BEGIN
 SELECT * INTO d FROM public.finance_documents WHERE id=(p->>'document_id')::uuid FOR UPDATE;
 IF NOT FOUND OR d.state<>'issued' THEN RAISE EXCEPTION 'Payments require an issued document.'; END IF;
 IF dt<d.issue_date THEN RAISE EXCEPTION 'Payment date cannot precede the document date.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.finance_accounts WHERE id=cash AND is_cash AND is_active) THEN RAISE EXCEPTION 'Choose an active cash or bank account.'; END IF;
 IF fx<=0 OR (d.currency=(SELECT base_currency FROM public.finance_settings WHERE id) AND fx<>1) THEN RAISE EXCEPTION 'Invalid settlement exchange rate.'; END IF;
 SELECT coalesce(sum(pmt.amount),0),coalesce(sum(base_carry),0) INTO paid,carried FROM public.finance_payments pmt WHERE document_id=d.id AND reversed_at IS NULL;
 IF amount<=0 OR amount>d.total-paid THEN RAISE EXCEPTION 'Payment must be positive and cannot exceed the outstanding balance (%).',d.total-paid; END IF;
 actual:=round(amount*fx,2); carry:=CASE WHEN paid+amount=d.total THEN d.base_total-carried ELSE round(amount*d.exchange_rate,2) END;
 IF actual<=0 OR carry<=0 OR carry>d.base_total-carried THEN RAISE EXCEPTION 'Payment is too small or inconsistent after currency conversion.'; END IF;
 delta:=actual-carry;
 IF d.kind='invoice' THEN
  lines:=jsonb_build_array(portal_finance.line(cash,actual,0),portal_finance.line(portal_finance.account('receivable'),0,carry));
  IF delta>0 THEN lines:=lines||jsonb_build_array(portal_finance.line(portal_finance.account('fx_gain'),0,delta));
  ELSIF delta<0 THEN lines:=lines||jsonb_build_array(portal_finance.line(portal_finance.account('fx_loss'),-delta,0)); END IF;
 ELSE
  lines:=jsonb_build_array(portal_finance.line(portal_finance.account('payable'),carry,0),portal_finance.line(cash,0,actual));
  IF delta>0 THEN lines:=lines||jsonb_build_array(portal_finance.line(portal_finance.account('fx_loss'),delta,0));
  ELSIF delta<0 THEN lines:=lines||jsonb_build_array(portal_finance.line(portal_finance.account('fx_gain'),0,-delta)); END IF;
 END IF;
 jid:=portal_finance.post(dt,'Payment — '||d.number,'payment',pid,lines);
 INSERT INTO public.finance_payments(id,document_id,cash_account_id,payment_date,amount,exchange_rate,base_cash,base_carry,reference,notes,journal_id,created_by)
 VALUES(pid,d.id,cash,dt,amount,fx,actual,carry,left(coalesce(p->>'reference',''),200),left(coalesce(p->>'notes',''),2000),jid,auth.uid());
 PERFORM portal_finance.audit('add_payment',pid,jsonb_build_object('document_id',d.id,'amount',amount,'base_cash',actual));
 RETURN jsonb_build_object('id',pid);
END; $$;

CREATE OR REPLACE FUNCTION portal_finance.report(p jsonb) RETURNS jsonb
 LANGUAGE plpgsql SET search_path='' AS $$
DECLARE f date:=coalesce(nullif(p->>'from','')::date,date_trunc('month',portal_finance.today())::date);
 t date:=coalesce(nullif(p->>'to','')::date,portal_finance.today()); result jsonb; period jsonb; balances jsonb;
 categories jsonb; trend jsonb; cash jsonb; v_outstanding jsonb;
BEGIN
 IF f>t THEN RAISE EXCEPTION 'Start date must be on/before the end date.'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.code),'[]') INTO period FROM (
  SELECT a.id,a.code,a.name,a.account_type,a.is_cash,coalesce(sum(l.debit),0) AS debit,coalesce(sum(l.credit),0) AS credit,
    coalesce(sum(l.debit-l.credit),0) AS net
  FROM public.finance_accounts a LEFT JOIN public.finance_ledger_view l ON l.account_id=a.id AND l.entry_date BETWEEN f AND t
  GROUP BY a.id
 ) x;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.code),'[]') INTO balances FROM (
  SELECT a.id,a.code,a.name,a.account_type,a.is_cash,coalesce(sum(l.debit),0) AS debit,coalesce(sum(l.credit),0) AS credit,
   coalesce(sum(l.debit-l.credit),0) AS net
  FROM public.finance_accounts a LEFT JOIN public.finance_ledger_view l ON l.account_id=a.id AND l.entry_date<=t
  GROUP BY a.id
 ) x;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.amount DESC),'[]') INTO categories FROM (
  SELECT a.id,a.name,sum(l.debit-l.credit) AS amount FROM public.finance_accounts a
  JOIN public.finance_ledger_view l ON l.account_id=a.id AND l.entry_date BETWEEN f AND t
  WHERE a.account_type='expense' GROUP BY a.id HAVING sum(l.debit-l.credit)<>0
 ) x;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.month),'[]') INTO trend FROM (
  SELECT to_char(date_trunc('month',entry_date),'YYYY-MM') AS month,
   sum(CASE WHEN account_type='income' THEN credit-debit ELSE 0 END) AS income,
   sum(CASE WHEN account_type='expense' THEN debit-credit ELSE 0 END) AS expense
  FROM public.finance_ledger_view WHERE entry_date BETWEEN f AND t GROUP BY date_trunc('month',entry_date)
 ) x;
 -- Accrual reports above use ledger dates. Outstanding/aging below are explicitly CURRENT.
 SELECT jsonb_build_object(
  'receivable',coalesce(sum(base_outstanding) FILTER(WHERE kind='invoice'),0),
  'payable',coalesce(sum(base_outstanding) FILTER(WHERE kind='bill'),0),
  'overdue_receivable',coalesce(sum(base_outstanding) FILTER(WHERE kind='invoice' AND is_overdue),0),
  'aging',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.due_date) FILTER(WHERE outstanding>0),'[]'))
 INTO v_outstanding FROM (
  SELECT id,number,kind,contact_name,due_date,currency,total,amount_paid,outstanding,base_outstanding,is_overdue,
   greatest(portal_finance.today()-due_date,0) AS days_overdue,
   CASE WHEN due_date>=portal_finance.today() THEN 'Current' WHEN portal_finance.today()-due_date<=30 THEN '1–30 days'
    WHEN portal_finance.today()-due_date<=60 THEN '31–60 days' WHEN portal_finance.today()-due_date<=90 THEN '61–90 days' ELSE '90+ days' END AS aging_bucket
  FROM public.finance_document_view WHERE state='issued' AND outstanding>0
 ) x;
 SELECT jsonb_build_object(
  'receipts',coalesce(sum(l.debit) FILTER(WHERE j.source_type='payment' AND d.kind='invoice'),0),
  'supplier_payments',coalesce(sum(l.credit) FILTER(WHERE j.source_type='payment' AND d.kind='bill'),0),
  'cash_in',coalesce(sum(l.debit),0),'cash_out',coalesce(sum(l.credit),0)) INTO cash
 FROM public.finance_journal_lines l JOIN public.finance_accounts a ON a.id=l.account_id AND a.is_cash
 JOIN public.finance_journals j ON j.id=l.journal_id
 LEFT JOIN public.finance_payments pm ON pm.id=j.source_id LEFT JOIN public.finance_documents d ON d.id=pm.document_id
 WHERE j.entry_date BETWEEN f AND t;
 RETURN jsonb_build_object('from',f,'to',t,'today',portal_finance.today(),'period',period,'balances',balances,
   'expense_categories',categories,'trend',trend,'outstanding',v_outstanding,'cash',cash);
END; $$;

CREATE OR REPLACE FUNCTION portal_finance.read_resource(p_action text,p jsonb) RETURNS jsonb
 LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result jsonb; page_limit int:=least(greatest(coalesce((p->>'limit')::int,50),1),500);
 page_offset int:=greatest(coalesce((p->>'offset')::int,0),0); q text:=left(coalesce(p->>'search',''),200);
 f date:=nullif(p->>'from','')::date; t date:=nullif(p->>'to','')::date;
 filter_account uuid:=nullif(p->>'account_id','')::uuid; filter_contact uuid:=nullif(p->>'contact_id','')::uuid;
 filter_category uuid:=nullif(p->>'category_id','')::uuid; state_filter text:=coalesce(p->>'status','');
BEGIN
 IF f IS NOT NULL AND t IS NOT NULL AND f>t THEN RAISE EXCEPTION 'Start date must be on/before the end date.'; END IF;
 IF p_action='bootstrap' THEN
  SELECT jsonb_build_object('level',portal_finance.access_level(),'today',portal_finance.today(),
   'settings',(SELECT to_jsonb(s) FROM public.finance_settings s WHERE id),
   'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY code) FROM public.finance_accounts a),'[]'),
   'contacts',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY name) FROM public.finance_contacts c),'[]')) INTO result;
 ELSIF p_action='report' THEN RETURN portal_finance.report(p);
 ELSIF p_action='get_document' THEN
  SELECT jsonb_build_object('document',to_jsonb(d),'payments',coalesce((
   SELECT jsonb_agg(to_jsonb(pm)||jsonb_build_object('cash_name',a.name) ORDER BY payment_date,pm.created_at)
   FROM public.finance_payments pm JOIN public.finance_accounts a ON a.id=pm.cash_account_id WHERE document_id=d.id),'[]'))
  INTO result FROM public.finance_document_view d WHERE d.id=(p->>'id')::uuid;
  IF result IS NULL THEN RAISE EXCEPTION 'Document not found.'; END IF;
 ELSIF p_action='list_documents' THEN
  WITH filtered AS MATERIALIZED (SELECT * FROM public.finance_document_view d WHERE
   kind=coalesce(p->>'kind','invoice') AND (q='' OR coalesce(number,'Draft') ILIKE '%'||q||'%' OR contact_name ILIKE '%'||q||'%' OR reference ILIKE '%'||q||'%')
   AND (state_filter='' OR status=state_filter) AND (f IS NULL OR issue_date>=f) AND (t IS NULL OR issue_date<=t)
   AND (filter_contact IS NULL OR contact_id=filter_contact)),
   paged AS (SELECT * FROM filtered ORDER BY issue_date DESC,created_at DESC,id LIMIT page_limit OFFSET page_offset)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY issue_date DESC,created_at DESC,id) FROM paged x),'[]'),
   'total',(SELECT count(*) FROM filtered)) INTO result;
 ELSIF p_action='list_expenses' THEN
  WITH filtered AS MATERIALIZED (SELECT * FROM public.finance_expense_view e WHERE
   (q='' OR description ILIKE '%'||q||'%' OR contact_name ILIKE '%'||q||'%' OR reference ILIKE '%'||q||'%')
   AND (state_filter='' OR state=state_filter) AND (f IS NULL OR expense_date>=f) AND (t IS NULL OR expense_date<=t)
   AND (filter_category IS NULL OR category_id=filter_category) AND (filter_account IS NULL OR cash_account_id=filter_account)),
   paged AS (SELECT * FROM filtered ORDER BY expense_date DESC,created_at DESC,id LIMIT page_limit OFFSET page_offset)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY expense_date DESC,created_at DESC,id) FROM paged x),'[]'),
   'total',(SELECT count(*) FROM filtered),'base_total',(SELECT coalesce(sum(base_amount) FILTER(WHERE state='posted'),0) FROM filtered)) INTO result;
 ELSIF p_action='list_ledger' THEN
  WITH filtered AS MATERIALIZED (SELECT * FROM public.finance_ledger_view l WHERE
   (q='' OR description ILIKE '%'||q||'%' OR account_name ILIKE '%'||q||'%' OR account_code ILIKE '%'||q||'%')
   AND (f IS NULL OR entry_date>=f) AND (t IS NULL OR entry_date<=t) AND (filter_account IS NULL OR account_id=filter_account)),
   paged AS (SELECT * FROM filtered ORDER BY entry_date,created_at,journal_id,id LIMIT page_limit OFFSET page_offset)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY entry_date,created_at,journal_id,id) FROM paged x),'[]'),
   'total',(SELECT count(*) FROM filtered),'debit',(SELECT coalesce(sum(debit),0) FROM filtered),'credit',(SELECT coalesce(sum(credit),0) FROM filtered),
   'opening',CASE WHEN filter_account IS NULL OR f IS NULL THEN 0 ELSE (SELECT coalesce(sum(debit-credit),0) FROM public.finance_ledger_view WHERE account_id=filter_account AND entry_date<f) END) INTO result;
 ELSIF p_action='list_contacts' THEN
  WITH filtered AS MATERIALIZED (SELECT * FROM public.finance_contacts WHERE q='' OR name ILIKE '%'||q||'%' OR email ILIKE '%'||q||'%' OR phone ILIKE '%'||q||'%'),
  paged AS (SELECT * FROM filtered ORDER BY name,id LIMIT page_limit OFFSET page_offset)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY name,id) FROM paged x),'[]'),'total',(SELECT count(*) FROM filtered)) INTO result;
 ELSIF p_action='list_audit' THEN
  WITH filtered AS MATERIALIZED (SELECT a.*,coalesce(pr.full_name,'Deleted user') AS actor_name FROM public.finance_audit a
   LEFT JOIN public.profiles pr ON pr.id=a.actor_id WHERE (q='' OR action ILIKE '%'||q||'%' OR pr.full_name ILIKE '%'||q||'%')
   AND (f IS NULL OR (a.created_at AT TIME ZONE (SELECT timezone FROM public.finance_settings WHERE id))::date>=f)
   AND (t IS NULL OR (a.created_at AT TIME ZONE (SELECT timezone FROM public.finance_settings WHERE id))::date<=t)),
   paged AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT page_limit OFFSET page_offset)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY created_at DESC,id DESC) FROM paged x),'[]'),'total',(SELECT count(*) FROM filtered)) INTO result;
 ELSIF p_action='list_access' THEN
  IF NOT portal_finance.is_super_admin() THEN RAISE EXCEPTION 'Only super admins can manage access.' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'email',u.email,'full_name',pr.full_name,
   'role',pr.role,'is_active',pr.is_active,'is_approved',pr.is_approved,'confirmed',u.email_confirmed_at IS NOT NULL,
   'level',CASE WHEN pr.role='super_admin' THEN 'admin' ELSE coalesce(fp.access_level,'none') END) ORDER BY pr.full_name),'[]'))
   INTO result FROM public.profiles pr JOIN auth.users u ON u.id=pr.id LEFT JOIN public.finance_permissions fp ON fp.user_id=pr.id;
 ELSE RAISE EXCEPTION 'Unknown accounting query.'; END IF;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION portal_finance.write_resource(p_action text,p jsonb) RETURNS jsonb
 LANGUAGE plpgsql SET search_path='' AS $$
<<write_resource>>
DECLARE v_id uuid:=CASE WHEN p_action='save_settings' THEN NULL ELSE nullif(p->>'id','')::uuid END; s public.finance_settings; a public.finance_accounts;
 d public.finance_documents; pm public.finance_payments; e public.finance_expenses; j public.finance_journals;
 jid uuid; dt date; cur text; fx numeric; amount numeric; base numeric; typ text; name text;
 lines jsonb; r jsonb; result jsonb; cash uuid; category uuid;
BEGIN
 IF p_action='save_document' THEN RETURN portal_finance.save_document(p);
 ELSIF p_action='issue_document' THEN RETURN portal_finance.issue_document(v_id,(p->>'version')::int);
 ELSIF p_action='add_payment' THEN RETURN portal_finance.add_payment(p);
 ELSIF p_action='save_contact' THEN
  name:=trim(coalesce(p->>'name','')); typ:=p->>'contact_type';
  IF length(name) NOT BETWEEN 1 AND 200 OR typ IS NULL OR typ NOT IN ('client','supplier','both') THEN RAISE EXCEPTION 'A name and valid contact type are required.'; END IF;
  IF v_id IS NULL THEN
   INSERT INTO public.finance_contacts(name,contact_type,email,phone,address,tax_id,notes,is_active,created_by)
   VALUES(name,typ,left(coalesce(p->>'email',''),200),left(coalesce(p->>'phone',''),80),left(coalesce(p->>'address',''),1500),
    left(coalesce(p->>'tax_id',''),120),left(coalesce(p->>'notes',''),2000),coalesce((p->>'is_active')::boolean,true),auth.uid()) RETURNING id INTO v_id;
  ELSE
   UPDATE public.finance_contacts SET name=write_resource.name,contact_type=typ,email=left(coalesce(p->>'email',''),200),phone=left(coalesce(p->>'phone',''),80),
    address=left(coalesce(p->>'address',''),1500),tax_id=left(coalesce(p->>'tax_id',''),120),notes=left(coalesce(p->>'notes',''),2000),
    is_active=coalesce((p->>'is_active')::boolean,true),updated_at=now() WHERE id=v_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Contact not found.'; END IF;
  END IF;
 ELSIF p_action='save_account' THEN
  name:=trim(coalesce(p->>'name','')); typ:=p->>'account_type';
  IF length(name) NOT BETWEEN 1 AND 200 OR typ IS NULL OR typ NOT IN ('asset','liability','equity','income','expense') OR coalesce(p->>'code','') !~ '^[A-Za-z0-9-]{1,20}$' THEN RAISE EXCEPTION 'Enter a name, unique account code, and valid type.'; END IF;
  IF coalesce((p->>'is_cash')::boolean,false) AND typ<>'asset' THEN RAISE EXCEPTION 'Cash/bank accounts must be assets.'; END IF;
  IF v_id IS NULL THEN
   INSERT INTO public.finance_accounts(code,name,account_type,is_cash,is_active)
   VALUES(p->>'code',name,typ,coalesce((p->>'is_cash')::boolean,false),coalesce((p->>'is_active')::boolean,true)) RETURNING id INTO v_id;
  ELSE
   SELECT * INTO a FROM public.finance_accounts WHERE id=v_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Account not found.'; END IF;
   IF a.system_key IS NOT NULL AND (a.account_type<>typ OR a.is_cash IS DISTINCT FROM coalesce((p->>'is_cash')::boolean,false)
    OR coalesce((p->>'is_active')::boolean,true)=false OR a.code<>p->>'code') THEN RAISE EXCEPTION 'System account codes, types and active flags are protected.'; END IF;
   IF (a.account_type<>typ OR a.is_cash IS DISTINCT FROM coalesce((p->>'is_cash')::boolean,false)) AND
    EXISTS(SELECT 1 FROM public.finance_journal_lines WHERE account_id=a.id) THEN RAISE EXCEPTION 'An account with posted entries cannot change type.'; END IF;
   UPDATE public.finance_accounts SET code=p->>'code',name=write_resource.name,account_type=typ,is_cash=coalesce((p->>'is_cash')::boolean,false),
    is_active=coalesce((p->>'is_active')::boolean,true) WHERE id=v_id;
  END IF;
 ELSIF p_action='save_settings' THEN
  IF NOT portal_finance.is_super_admin() THEN RAISE EXCEPTION 'Only super admins can change business settings.' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.finance_settings WHERE id;
  cur:=p->>'base_currency'; name:=trim(coalesce(p->>'business_name',''));
  IF cur IS NULL OR cur NOT IN ('PKR','USD') OR length(name) NOT BETWEEN 1 AND 200
   OR coalesce(p->>'invoice_prefix','') !~ '^[A-Z0-9]{2,12}$' OR coalesce(p->>'bill_prefix','') !~ '^[A-Z0-9]{2,12}$'
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names tz WHERE tz.name=p->>'timezone') THEN RAISE EXCEPTION 'Invalid business name, currency, timezone, or numbering prefix.'; END IF;
  IF p->>'invoice_prefix'=p->>'bill_prefix' THEN RAISE EXCEPTION 'Invoice and bill prefixes must be different.'; END IF;
  IF s.base_currency<>cur AND (EXISTS(SELECT 1 FROM public.finance_documents) OR EXISTS(SELECT 1 FROM public.finance_journals)) THEN RAISE EXCEPTION 'Base currency cannot change after financial records exist.'; END IF;
  IF coalesce(p->>'logo_path','') NOT IN ('','images/haulxify.webp','images/aims.webp','images/Union.webp') THEN RAISE EXCEPTION 'Choose an available business logo.'; END IF;
  UPDATE public.finance_settings SET business_name=write_resource.name,base_currency=cur,address=left(coalesce(p->>'address',''),1500),
   email=left(coalesce(p->>'email',''),200),phone=left(coalesce(p->>'phone',''),80),tax_id=left(coalesce(p->>'tax_id',''),120),logo_path=p->>'logo_path',
   timezone=p->>'timezone',invoice_prefix=p->>'invoice_prefix',bill_prefix=p->>'bill_prefix',payment_details=left(coalesce(p->>'payment_details',''),2500),
   default_terms=left(coalesce(p->>'default_terms',''),4000),closed_through=nullif(p->>'closed_through','')::date,updated_at=now() WHERE id;
  result:=jsonb_build_object('saved',true);
 ELSIF p_action='set_access' THEN
  IF NOT portal_finance.is_super_admin() THEN RAISE EXCEPTION 'Only super admins can grant accounts access.' USING ERRCODE='42501'; END IF;
  IF v_id IS NULL OR p->>'level' IS NULL OR p->>'level' NOT IN ('none','view','edit') OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_id) THEN RAISE EXCEPTION 'Choose an existing portal user and access level.'; END IF;
  IF EXISTS(SELECT 1 FROM public.profiles WHERE id=v_id AND role='super_admin') THEN RAISE EXCEPTION 'Super admins already have full access.'; END IF;
  INSERT INTO public.finance_permissions(user_id,access_level,granted_by) VALUES(v_id,p->>'level',auth.uid())
  ON CONFLICT(user_id) DO UPDATE SET access_level=EXCLUDED.access_level,granted_by=EXCLUDED.granted_by,updated_at=now();
 ELSIF p_action='delete_draft' THEN
  SELECT * INTO d FROM public.finance_documents WHERE id=v_id FOR UPDATE;
  IF NOT FOUND OR d.state<>'draft' THEN RAISE EXCEPTION 'Only a draft can be deleted. Void issued documents instead.'; END IF;
  PERFORM portal_finance.audit('delete_draft',v_id,to_jsonb(d));
  DELETE FROM public.finance_documents WHERE id=v_id;
  RETURN jsonb_build_object('deleted',true);
 ELSIF p_action='void_document' THEN
  SELECT * INTO d FROM public.finance_documents WHERE id=v_id FOR UPDATE;
  IF NOT FOUND OR d.state<>'issued' THEN RAISE EXCEPTION 'Only an issued document can be voided.'; END IF;
  IF EXISTS(SELECT 1 FROM public.finance_payments WHERE document_id=d.id AND reversed_at IS NULL) THEN RAISE EXCEPTION 'Reverse this document''s payments before voiding it.'; END IF;
  dt:=(p->>'date')::date; jid:=portal_finance.reverse(d.journal_id,dt,p->>'reason');
  UPDATE public.finance_documents SET state='void',void_reason=p->>'reason',void_date=dt,version=version+1,updated_at=now() WHERE id=d.id;
 ELSIF p_action='reset_payments' THEN
  SELECT * INTO d FROM public.finance_documents WHERE id=v_id FOR UPDATE;
  IF NOT FOUND OR d.state<>'issued' THEN RAISE EXCEPTION 'Choose an issued document.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.finance_payments WHERE document_id=v_id AND reversed_at IS NULL) THEN RAISE EXCEPTION 'This document has no active payments to reverse.'; END IF;
  FOR pm IN SELECT * FROM public.finance_payments WHERE document_id=v_id AND reversed_at IS NULL ORDER BY payment_date,id LOOP
   PERFORM portal_finance.reverse(pm.journal_id,(p->>'date')::date,p->>'reason');
   UPDATE public.finance_payments SET reversed_at=now(),reversal_date=(p->>'date')::date,reversal_reason=p->>'reason' WHERE id=pm.id;
  END LOOP;
 ELSIF p_action='reverse_payment' THEN
  SELECT * INTO pm FROM public.finance_payments WHERE id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  PERFORM 1 FROM public.finance_documents WHERE id=pm.document_id FOR UPDATE;
  SELECT * INTO pm FROM public.finance_payments WHERE id=v_id FOR UPDATE;
  IF pm.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Payment has already been reversed.'; END IF;
  dt:=(p->>'date')::date; jid:=portal_finance.reverse(pm.journal_id,dt,p->>'reason');
  UPDATE public.finance_payments SET reversed_at=now(),reversal_date=dt,reversal_reason=p->>'reason' WHERE id=v_id;
 ELSIF p_action='add_expense' THEN
  dt:=(p->>'expense_date')::date; cur:=p->>'currency'; fx:=portal_finance.decimal_value(p->>'exchange_rate',8);
  amount:=portal_finance.decimal_value(p->>'amount'); base:=round(amount*fx,2);
  cash:=(p->>'cash_account_id')::uuid; category:=(p->>'category_id')::uuid; name:=trim(coalesce(p->>'description',''));
  IF cur IS NULL OR cur NOT IN ('PKR','USD') OR amount<=0 OR fx<=0 OR base<=0 OR length(name) NOT BETWEEN 1 AND 500
   OR (cur=(SELECT base_currency FROM public.finance_settings WHERE id) AND fx<>1) THEN RAISE EXCEPTION 'Invalid expense amount, description, currency, or rate.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.finance_accounts WHERE id=cash AND is_cash AND is_active) OR
   NOT EXISTS(SELECT 1 FROM public.finance_accounts WHERE id=category AND account_type='expense' AND is_active) THEN RAISE EXCEPTION 'Choose an active expense category and cash/bank account.'; END IF;
  v_id:=gen_random_uuid(); jid:=portal_finance.post(dt,name,'expense',v_id,jsonb_build_array(portal_finance.line(category,base,0),portal_finance.line(cash,0,base)));
  INSERT INTO public.finance_expenses(id,expense_date,description,category_id,cash_account_id,contact_id,currency,exchange_rate,amount,base_amount,reference,notes,journal_id,created_by)
  VALUES(v_id,dt,name,category,cash,nullif(p->>'contact_id','')::uuid,cur,fx,amount,base,left(coalesce(p->>'reference',''),200),left(coalesce(p->>'notes',''),2000),jid,auth.uid());
 ELSIF p_action='replace_expense' THEN
  SELECT * INTO e FROM public.finance_expenses WHERE id=v_id FOR UPDATE;
  IF NOT FOUND OR e.state<>'posted' THEN RAISE EXCEPTION 'Expense is missing or already voided.'; END IF;
  PERFORM portal_finance.reverse(e.journal_id,(p->>'reversal_date')::date,p->>'reason');
  UPDATE public.finance_expenses SET state='void',void_reason=p->>'reason',void_date=(p->>'reversal_date')::date WHERE id=v_id;
  PERFORM portal_finance.audit('replace_expense_original',v_id,p);
  RETURN portal_finance.write_resource('add_expense',p-'id');
 ELSIF p_action='void_expense' THEN
  SELECT * INTO e FROM public.finance_expenses WHERE id=v_id FOR UPDATE;
  IF NOT FOUND OR e.state<>'posted' THEN RAISE EXCEPTION 'Expense is missing or already voided.'; END IF;
  dt:=(p->>'date')::date; jid:=portal_finance.reverse(e.journal_id,dt,p->>'reason');
  UPDATE public.finance_expenses SET state='void',void_reason=p->>'reason',void_date=dt WHERE id=v_id;
 ELSIF p_action='transfer' THEN
  amount:=portal_finance.decimal_value(p->>'amount'); dt:=(p->>'date')::date;
  cash:=(p->>'from_account_id')::uuid; category:=(p->>'to_account_id')::uuid;
  IF amount<=0 OR cash=category OR (SELECT count(*) FROM public.finance_accounts WHERE id IN(cash,category) AND is_cash AND is_active)<>2 THEN RAISE EXCEPTION 'Choose two different active cash/bank accounts and a positive amount.'; END IF;
  v_id:=gen_random_uuid(); jid:=portal_finance.post(dt,left('Transfer: '||coalesce(p->>'description','Cash / bank movement'),500),'transfer',v_id,
   jsonb_build_array(portal_finance.line(category,amount,0),portal_finance.line(cash,0,amount)));
 ELSIF p_action='post_journal' THEN
  IF jsonb_typeof(p->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'lines') NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'Journal needs between 2 and 100 lines.'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p->'lines') LOOP
   IF EXISTS(SELECT 1 FROM public.finance_accounts WHERE id=(r->>'account_id')::uuid AND system_key IN ('receivable','payable')) THEN
    RAISE EXCEPTION 'Use opening invoices/bills for receivables/payables so client and supplier balances remain accurate.';
   END IF;
  END LOOP;
  v_id:=gen_random_uuid(); jid:=portal_finance.post((p->>'date')::date,p->>'description','manual',v_id,p->'lines');
 ELSIF p_action='reverse_journal' THEN
  SELECT * INTO j FROM public.finance_journals WHERE id=v_id;
  IF NOT FOUND OR j.source_type NOT IN ('manual','transfer') THEN RAISE EXCEPTION 'Reverse invoices, bills, expenses and payments through their original records.'; END IF;
  jid:=portal_finance.reverse(v_id,(p->>'date')::date,p->>'reason');
 ELSE RAISE EXCEPTION 'Unknown accounting action.'; END IF;
 PERFORM portal_finance.audit(p_action,v_id,p-'request_id');
 RETURN coalesce(result,jsonb_build_object('id',v_id,'journal_id',jid));
END; $$;

-- Private transactional API: validates identity on EVERY call; serializes writes
-- against the settings row, and makes retries idempotent for each request UUID.
CREATE OR REPLACE FUNCTION portal_finance.api(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rid uuid; fingerprint text; cached portal_finance.requests; answer jsonb;
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR length(p_payload::text)>260000 THEN RAISE EXCEPTION 'Invalid accounting request.'; END IF;
 IF p_action='access' THEN
  RETURN jsonb_build_object('level',portal_finance.access_level());
 END IF;
 PERFORM portal_finance.require_access(false);
 IF p_action IN ('bootstrap','report','get_document','list_documents','list_expenses','list_ledger','list_contacts','list_audit','list_access') THEN
  RETURN portal_finance.read_resource(p_action,p_payload);
 END IF;
 PERFORM portal_finance.require_access(true);
 rid:=nullif(p_payload->>'request_id','')::uuid;
 IF rid IS NULL THEN RAISE EXCEPTION 'A request ID is required for financial changes.'; END IF;
 -- Permission is checked before returning a cached result, including after revocation.
 PERFORM 1 FROM public.finance_settings WHERE id FOR UPDATE;
 PERFORM portal_finance.require_access(true);
 fingerprint:=md5(p_action||':'||(p_payload-'request_id')::text);
 SELECT * INTO cached FROM portal_finance.requests WHERE actor_id=auth.uid() AND request_id=rid;
 IF FOUND THEN
  IF cached.payload_hash<>fingerprint THEN RAISE EXCEPTION 'This request ID was already used for another change. Reload the form.'; END IF;
  RETURN cached.result;
 END IF;
 answer:=portal_finance.write_resource(p_action,p_payload);
 INSERT INTO portal_finance.requests(actor_id,request_id,payload_hash,result) VALUES(auth.uid(),rid,fingerprint,answer);
 RETURN answer;
END; $$;
CREATE OR REPLACE FUNCTION public.finance_api(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
 LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT portal_finance.api(p_action,p_payload); $$;
REVOKE ALL ON FUNCTION public.finance_api(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finance_api(text,jsonb) TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal_finance FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION portal_finance.api(text,jsonb),portal_finance.access_level(),portal_finance.today() TO authenticated;

-- All finance tables deny direct writes. The transactional API is the only writer.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['finance_settings','finance_permissions','finance_contacts','finance_accounts','finance_journals','finance_journal_lines','finance_documents','finance_payments','finance_expenses','finance_audit'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tbl);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tbl);
  EXECUTE format('DROP POLICY IF EXISTS finance_read ON public.%I',tbl);
  EXECUTE format('CREATE POLICY finance_read ON public.%I FOR SELECT TO authenticated USING ((SELECT portal_finance.access_level()) <> ''none'')',tbl);
 END LOOP;
END $$;
-- Permissions themselves are only readable by their owner and super admins.
DROP POLICY IF EXISTS finance_read ON public.finance_permissions;
CREATE POLICY finance_read ON public.finance_permissions FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()) OR (SELECT portal_finance.access_level())='admin');
REVOKE ALL ON ALL TABLES IN SCHEMA portal_finance FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA portal_finance FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.finance_document_view,public.finance_expense_view,public.finance_ledger_view FROM PUBLIC,anon;
GRANT SELECT ON public.finance_document_view,public.finance_expense_view,public.finance_ledger_view TO authenticated;

COMMIT;
-- AFTER running: invite/create the Union user if needed, then use Accounts →
-- Access to grant View only. Existing Union identities are seeded View only above.
-- Verify using accounts_verify.sql. No user password is created by this file.
