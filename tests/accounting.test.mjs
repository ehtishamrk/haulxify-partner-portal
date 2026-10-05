import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('accounting database: calculations, lifecycle, reports, retries and access boundaries', async t => {
 const db = new PGlite();
 const admin=randomUUID(), viewer=randomUUID(), agent=randomUUID(), editor=randomUUID(), pending=randomUUID();
 const fixture=`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,
  raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub' $$;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') $$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
 GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated,anon;
 `;
 // Fix the return cast before creating the fixture function.
 await db.exec(fixture.replace("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub' $$;",''));
 const original=await readFile(new URL('../setup.sql',import.meta.url),'utf8');
 await db.exec(original.slice(0,original.indexOf('-- 2. LEADS TABLE')));
 await db.exec(`ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  GRANT SELECT,INSERT,UPDATE,DELETE ON public.profiles TO authenticated;
  CREATE POLICY fixture_select ON public.profiles FOR SELECT TO authenticated USING(true);
  CREATE POLICY fixture_update ON public.profiles FOR UPDATE TO authenticated USING(id=auth.uid() OR EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='super_admin'));
 `);
 for(const [id,email,role,confirmed] of [[admin,'owner@example.com','super_admin',true],[viewer,'unionenterprisespakistan@gmail.com','sales_agent',true],
  [agent,'agent@example.com','sales_agent',true],[editor,'editor@example.com','sales_agent',true],[pending,'pending@example.com','sales_agent',false]]) {
  await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,CASE WHEN $3 THEN now() ELSE NULL END)',[id,email,confirmed]);
  await db.query('INSERT INTO public.profiles(id,email,full_name,role) VALUES($1,$2,$2,$3)',[id,email,role]);
 }
 const installer=await readFile(new URL('../accounts_setup.sql',import.meta.url),'utf8');
 await db.exec(installer);
 await db.exec(installer); // reruns must keep records and avoid duplicate seeds/policies
 async function as(id,role='authenticated') {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role})]);
  await db.exec(`SET ROLE ${role}`);
 }
 async function api(action,p={}) {
  const r=await db.query('SELECT public.finance_api($1,$2::jsonb) AS value',[action,JSON.stringify(p)]);
  return r.rows[0].value;
 }
 const write=(action,p={})=>api(action,{...p,request_id:p.request_id||randomUUID()});
 await as(admin);
 let boot=await api('bootstrap');
 const account=key=>boot.accounts.find(a=>a.system_key===key).id;
 let client, supplier, invoice, payment;
 const today=boot.today;
 await t.test('installer creates one set of settings and all system accounts',async()=>{
  assert.equal(boot.settings.base_currency,'PKR');assert.equal(boot.accounts.length,27);
 });
 await t.test('super admin creates client and supplier',async()=>{
  client=(await write('save_contact',{name:"Client <script>alert(1)</script>",contact_type:'client'})).id;
  supplier=(await write('save_contact',{name:'Supplier',contact_type:'supplier'})).id;
 });
 const doc=(kind,extra={})=>({kind,contact_id:kind==='invoice'?client:supplier,issue_date:today,due_date:today,currency:'PKR',exchange_rate:'1',
  items:[{description:'Services',account_id:account(kind==='invoice'?'revenue':'software'),quantity:'1',rate:'100',discount_pct:'0',tax_pct:'0'}],...extra});
 await t.test('draft is not posted and saves exact line discounts and tax',async()=>{
  invoice=await write('save_document',doc('invoice',{items:[{description:'Work',account_id:account('revenue'),quantity:'3',rate:'99.99',discount_pct:'10',tax_pct:'17'}]}));
  const d=(await api('get_document',{id:invoice.id})).document;
  assert.equal(d.total,315.86);assert.equal(d.discount_total,30);assert.equal(d.tax_total,45.89);assert.equal(d.state,'draft');
  const report=await api('report');assert.equal(report.balances.find(a=>a.id===account('receivable')).net,0);
 });
 await t.test('stale draft save is rejected',async()=>{
  await assert.rejects(write('save_document',doc('invoice',{id:invoice.id,version:0})),/changed in another tab/);
 });
 await t.test('issuing a draft generates an invoice and posts receivable and tax',async()=>{
  await write('issue_document',{id:invoice.id,version:invoice.version});
  const d=(await api('get_document',{id:invoice.id})).document;
  assert.match(d.number,/^INV-/);assert.equal(d.status,'unpaid');assert.equal(d.base_outstanding,315.86);
 });
 await t.test('partial payment and idempotent retry only record one receipt',async()=>{
  const request_id=randomUUID();const p={document_id:invoice.id,cash_account_id:account('bank'),payment_date:today,amount:'100',exchange_rate:'1',request_id};
  payment=await write('add_payment',p);assert.deepEqual(await write('add_payment',p),payment);
  const d=(await api('get_document',{id:invoice.id})).document;assert.equal(d.status,'partial');assert.equal(d.outstanding,215.86);
  await assert.rejects(write('add_payment',{...p,amount:'101'}),/already used/);
 });
 await t.test('overpayment and direct posted edits are rejected',async()=>{
  await assert.rejects(write('add_payment',{document_id:invoice.id,cash_account_id:account('bank'),payment_date:today,amount:'999',exchange_rate:'1'}),/cannot exceed/);
  await assert.rejects(write('save_document',doc('invoice',{id:invoice.id,version:2})),/Only an existing draft/);
  await assert.rejects(write('delete_draft',{id:invoice.id}),/Only a draft/);
 });
 await t.test('final payment makes invoice paid and clears receivables',async()=>{
  await write('add_payment',{document_id:invoice.id,cash_account_id:account('bank'),payment_date:today,amount:'215.86',exchange_rate:'1'});
  const d=(await api('get_document',{id:invoice.id})).document;assert.equal(d.status,'paid');assert.equal(d.base_outstanding,0);
 });
 await t.test('reversing a payment restores the balance and leaves history',async()=>{
  await write('reverse_payment',{id:payment.id,date:today,reason:'Receipt entered incorrectly'});
  const r=await api('get_document',{id:invoice.id});assert.equal(r.document.outstanding,100);assert.equal(r.payments.length,2);assert.ok(r.payments[0].reversed_at);
  await assert.rejects(write('void_document',{id:invoice.id,date:today,reason:'Cancelled'}),/Reverse this document/);
 });
 await t.test('USD invoice settles at a new exchange rate and posts realized FX gain',async()=>{
  const d=await write('save_document',doc('invoice',{currency:'USD',exchange_rate:'280',issue_now:true}));
  await write('add_payment',{document_id:d.id,cash_account_id:account('bank'),payment_date:today,amount:'100',exchange_rate:'285'});
  const report=await api('report');assert.equal(report.balances.find(a=>a.id===account('fx_gain')).net,-500);
 });
 await t.test('supplier bill and settlement reduce payable and post expense',async()=>{
  const bill=await write('save_document',doc('bill',{issue_now:true}));
  await write('add_payment',{document_id:bill.id,cash_account_id:account('bank'),payment_date:today,amount:'100',exchange_rate:'1'});
  assert.equal((await api('get_document',{id:bill.id})).document.status,'paid');
 });
 await t.test('expense category, dates and reversal affect reports',async()=>{
  const exp=await write('add_expense',{description:'Office rent',expense_date:today,currency:'PKR',exchange_rate:'1',amount:'200',category_id:account('rent'),cash_account_id:account('bank')});
  assert.equal((await api('list_expenses',{category_id:account('rent'),from:today,to:today})).base_total,200);
  await write('void_expense',{id:exp.id,date:today,reason:'Expense duplicated'});
  assert.equal((await api('report')).balances.find(a=>a.id===account('rent')).net,0);
 });
 await t.test('manual opening journal and transfer keep double entry balance',async()=>{
  await write('post_journal',{date:today,description:'Opening capital',lines:[{account_id:account('bank'),debit:'10000',credit:'0'},{account_id:account('capital'),debit:'0',credit:'10000'}]});
  await write('transfer',{date:today,amount:'1000',from_account_id:account('bank'),to_account_id:account('cash')});
  const report=await api('report');assert.equal(report.balances.reduce((s,a)=>s+Math.round(a.net*100),0),0);
  await assert.rejects(write('post_journal',{date:today,description:'Unbalanced',lines:[{account_id:account('cash'),debit:'10',credit:'0'},{account_id:account('capital'),debit:'0',credit:'9'}]}),/balance exactly/);
  await assert.rejects(write('post_journal',{date:today,description:'Control account bypass',lines:[{account_id:account('receivable'),debit:'10',credit:'0'},{account_id:account('capital'),debit:'0',credit:'10'}]}),/opening invoices/);
 });
 await t.test('opening invoices post equity without inflating current income',async()=>{
  const before=(await api('report')).balances.find(a=>a.id===account('revenue')).net;
  await write('save_document',doc('invoice',{is_opening:true,issue_now:true}));
  const after=(await api('report')).balances.find(a=>a.id===account('revenue')).net;assert.equal(after,before);
 });
 await t.test('viewer can read/export records but cannot create, change, delete, or grant',async()=>{
  await as(viewer);assert.equal((await api('access')).level,'view');assert.ok((await api('list_documents')).total>0);
  assert.ok((await db.query('SELECT * FROM public.finance_document_view')).rows.length>0);
  for(const action of ['save_contact','delete_draft','set_access','add_expense','reverse_payment']) await assert.rejects(write(action,{id:invoice.id}),/permission/);
  await assert.rejects(api('list_access'),/Only super admins/);
  await assert.rejects(db.query('UPDATE public.finance_documents SET state=$1 WHERE id=$2',['void',invoice.id]),/permission denied/);
 });
 await t.test('ordinary user cannot read tables, views or financial API',async()=>{
  await as(agent);assert.equal((await api('access')).level,'none');
  assert.equal((await db.query('SELECT * FROM public.finance_documents')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM public.finance_document_view')).rows.length,0);
  await assert.rejects(api('bootstrap'),/permission/);
  await assert.rejects(db.query("UPDATE public.profiles SET role='super_admin' WHERE id=$1",[agent]),/Only a super admin/);
  await assert.rejects(db.query('UPDATE public.profiles SET email=$1 WHERE id=$2',['unionenterprisespakistan@gmail.com',agent]),/Only a super admin/);
 });
 await t.test('super admin grants editing; editor cannot grant access or change settings',async()=>{
  await as(admin);await write('set_access',{id:editor,level:'edit'});
  await as(editor);assert.equal((await api('access')).level,'edit');
  await write('save_contact',{name:'Editor-created client',contact_type:'client'});
  await assert.rejects(write('set_access',{id:agent,level:'edit'}),/Only super admins/);
  await assert.rejects(write('save_settings',{}),/Only super admins/);
 });
 await t.test('revoking access blocks even a formerly successful retry',async()=>{
  const req={name:'Retry check',contact_type:'client',request_id:randomUUID()};await write('save_contact',req);
  await as(admin);await write('set_access',{id:editor,level:'none'});await as(editor);
  await assert.rejects(write('save_contact',req),/permission/);
 });
 await t.test('unconfirmed or inactive identities cannot use finance',async()=>{
  await as(admin);await write('set_access',{id:pending,level:'view'});await as(pending);
  assert.equal((await api('access')).level,'none');
  await as(admin);await db.query('UPDATE public.profiles SET is_active=false WHERE id=$1',[viewer]);await as(viewer);
  assert.equal((await api('access')).level,'none');
 });
 await t.test('period lock blocks posting and reversals on closed dates',async()=>{
  await as(admin);boot=await api('bootstrap');
  await write('save_settings',{...boot.settings,closed_through:today});
  await assert.rejects(write('transfer',{date:today,amount:'10',from_account_id:account('bank'),to_account_id:account('cash')}),/period is locked/);
  await write('save_settings',{...boot.settings,closed_through:''});
 });
 await t.test('base currency cannot be changed after books contain records',async()=>{
  await assert.rejects(write('save_settings',{...boot.settings,base_currency:'USD'}),/Base currency cannot change/);
 });
 await as(admin);
  await t.test('resetting all payments is atomic and restores unpaid status',async()=>{
   await write('reset_payments',{id:invoice.id,date:today,reason:'All receipts were recorded against the wrong invoice'});
   const data=await api('get_document',{id:invoice.id});assert.equal(data.document.status,'unpaid');assert.equal(data.document.outstanding,315.86);
   assert.ok(data.payments.every(p=>p.reversed_at));
   await write('void_document',{id:invoice.id,date:today,reason:'Invoice cancelled'});
   const cancelled=(await api('get_document',{id:invoice.id})).document;assert.equal(cancelled.outstanding,0);assert.equal(cancelled.base_outstanding,0);
  });
  await t.test('expense correction reverses and replaces in one transaction',async()=>{
   const p={description:'Transport cost',expense_date:today,currency:'PKR',exchange_rate:'1',amount:'100',category_id:account('fuel'),cash_account_id:account('bank')};
   const old=await write('add_expense',p);
   const replacement=await write('replace_expense',{...p,id:old.id,amount:'150',reversal_date:today,reason:'Correct amount from receipt'});
   assert.notEqual(old.id,replacement.id);
   const expenses=await api('list_expenses',{category_id:account('fuel')});assert.equal(expenses.base_total,150);
   assert.equal(expenses.rows.find(e=>e.id===old.id).state,'void');
  });
  await t.test('updating a draft works while issued business details remain frozen',async()=>{
   const draft=await write('save_document',doc('invoice'));
   const revised=await write('save_document',doc('invoice',{id:draft.id,version:draft.version,reference:'Revised draft'}));assert.equal(revised.version,2);
   const issued=await write('save_document',doc('invoice',{issue_now:true}));const old=(await api('get_document',{id:issued.id})).document.issuer_snapshot.business_name;
   await write('save_settings',{...boot.settings,business_name:'Changed business name',closed_through:''});
   assert.equal((await api('get_document',{id:issued.id})).document.issuer_snapshot.business_name,old);
   await write('save_settings',{...boot.settings,closed_through:''});
  });
  await t.test('many tiny converted lines balance without a rounding residual',async()=>{
   const items=Array.from({length:200},(_,i)=>({description:'Small line '+i,account_id:account('revenue'),quantity:'1',rate:'0.03',discount_pct:'0',tax_pct:'0'}));
   const result=await write('save_document',doc('invoice',{currency:'USD',exchange_rate:'0.2',items,issue_now:true}));
   assert.equal((await api('get_document',{id:result.id})).document.base_total,1.2);
   const report=await api('report');assert.equal(report.balances.reduce((s,a)=>s+Math.round(a.net*100),0),0);
  });
  await t.test('signup metadata cannot grant an admin role',async()=>{
   await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claims','{}',false)");
   await db.exec('CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()');
   const id=randomUUID();await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,'{\"role\":\"super_admin\"}')",[id,'spoof@example.com']);
   assert.equal((await db.query('SELECT role FROM public.profiles WHERE id=$1',[id])).rows[0].role,'sales_agent');
  });
 await t.test('anonymous role cannot execute public financial RPC',async()=>{
  await as(admin);
  await assert.rejects(write('save_settings',{...boot.settings,invoice_prefix:'INV',bill_prefix:'INV'}),/prefixes must be different/);
  await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claims','{}',false)");
  await db.exec("SELECT setval('portal_finance.invoice_number',10000000)");await as(admin);
  const numbered=await write('save_document',doc('invoice',{issue_now:true}));assert.ok(numbered.number.endsWith('-10000001'));
  await as(null,'anon');await assert.rejects(api('access'),/permission denied/);
 });
 await t.test('posted ledger is immutable even to direct owner edits',async()=>{
  await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claims','{}',false)");
  await assert.rejects(db.query("UPDATE public.finance_journals SET description='tampered'"),/immutable/);
  await assert.rejects(db.query('DELETE FROM public.finance_journal_lines'),/immutable/);
 });
 await db.close();
});
