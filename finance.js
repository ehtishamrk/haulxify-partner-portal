/* Accounts & Billing. Authorization, arithmetic and posting rules run in Postgres. */
(function(){
 'use strict';
 const C=FinanceCore,E=C.escape,$=id=>document.getElementById(id);
 const state={boot:null,tab:'overview',filters:{},page:0,pageSize:30,rows:[],report:null,reportKind:'profit_loss',renderToken:0,dialogBusy:false};
 const titles={overview:'Overview',invoices:'Invoices',expenses:'Expenses',bills:'Supplier bills',contacts:'Clients & suppliers',banking:'Cash & bank',ledger:'Ledger',reports:'Reports',audit:'Audit log',access:'Access',settings:'Business settings'};
 const canEdit=()=>['admin','edit'].includes(state.boot?.level),isAdmin=()=>state.boot?.level==='admin';
 const base=()=>state.boot.settings.base_currency,money=(v,cur=base())=>C.money(v,cur),date=C.date;
 const account=id=>state.boot.accounts.find(x=>x.id===id),contact=id=>state.boot.contacts.find(x=>x.id===id);
 const btn=(label,action,id='',primary=false)=>`<button type="button" class="btn ${primary?'btn-primary':'btn-ghost'} btn-sm" data-action="${action}" data-id="${E(id)}">${E(label)}</button>`;
 const badge=s=>`<span class="finance-status ${E(s)}">${E({partial:'Partially paid',void:'Voided'}[s]||s.charAt(0).toUpperCase()+s.slice(1))}</span>`;
 const empty=(title,text,action='')=>`<div class="finance-empty"><strong>${E(title)}</strong><p>${E(text)}</p>${action}</div>`;
 const panel=(title,body,actions='',sub='')=>`<div class="finance-panel"><div class="finance-panel-head"><div><h2>${E(title)}</h2>${sub?`<p>${E(sub)}</p>`:''}</div><div class="finance-toolbar">${actions}</div></div>${body}</div>`;
 const table=(headers,rows)=>`<div class="finance-table-wrap"><table class="finance-table"><thead><tr>${headers.map(h=>`<th${h[1]?' class="numeric"':''}>${E(h[0]||h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
 const total=rows=>C.sum(rows);
 async function api(action,p={}){
  const {data,error}=await sb.rpc('finance_api',{p_action:action,p_payload:p});
  if(error){
   if(error.code==='42501')setTimeout(refreshAccess,0);
   throw new Error(error.message||'Unable to complete this accounts action.');
  }
  return data;
 }
 async function write(action,p={},requestId=C.uuid()){return api(action,{...p,request_id:requestId});}
 function filter(){return state.filters[state.tab]||(state.filters[state.tab]={search:'',from:['overview','reports','banking','ledger'].includes(state.tab)?state.boot.today.slice(0,7)+'-01':'',to:['overview','reports','banking','ledger'].includes(state.tab)?state.boot.today:'',status:'',category_id:'',account_id:''});}
 function options(list,selected,placeholder='Choose…',label=x=>x.name){return `<option value="">${E(placeholder)}</option>`+list.map(x=>`<option value="${E(x.id)}"${x.id===selected?' selected':''}>${E(label(x))}</option>`).join('');}
 function activeAccounts(type,cash=false){return state.boot.accounts.filter(x=>x.is_active&&(!type||x.account_type===type)&&(!cash||x.is_cash));}
 function cashOptions(selected){return options(activeAccounts('asset',true),selected,'Choose cash / bank',x=>x.name);}
 function accountOptions(selected,type=''){return options(activeAccounts(type),selected,'Choose account',x=>`${x.code} · ${x.name}`);}
 function buildTabs(){
  $('finance-tabs').innerHTML=Object.entries(titles).filter(([k])=>isAdmin()||!['access','settings'].includes(k)).map(([k,v])=>`<button type="button" class="finance-tab ${k===state.tab?'active':''}" data-tab="${k}" aria-current="${k===state.tab?'page':'false'}">${E(v)}</button>`).join('');
 }
 function buildFilters(){
  const f=filter();
  if(['settings','access'].includes(state.tab)){$('finance-filters').innerHTML='';return;}
  let html='';
  if(!['overview','reports','banking'].includes(state.tab))html+=`<label class="search-filter">Search<input type="search" name="search" value="${E(f.search)}" placeholder="Search ${E(titles[state.tab].toLowerCase())}"></label>`;
  if(state.tab!=='contacts')html+=`<label>From<input type="date" name="from" value="${E(f.from)}"></label><label>To<input type="date" name="to" value="${E(f.to)}"></label>`;
  if(['invoices','bills','expenses'].includes(state.tab)){
   const choices=state.tab==='expenses'?['posted','void']:['draft','unpaid','partial','paid','overdue','void'];
   html+=`<label>Status<select name="status"><option value="">All statuses</option>${choices.map(x=>`<option value="${x}"${f.status===x?' selected':''}>${E(x==='partial'?'Partially paid':x.charAt(0).toUpperCase()+x.slice(1))}</option>`).join('')}</select></label>`;
  }
  if(state.tab==='expenses')html+=`<label>Category<select name="category_id">${options(state.boot.accounts.filter(x=>x.account_type==='expense'),f.category_id,'All categories')}</select></label>`;
  if(['expenses','ledger'].includes(state.tab))html+=`<label>${state.tab==='expenses'?'Paid from':'Account'}<select name="account_id">${options(state.boot.accounts.filter(x=>state.tab==='ledger'||x.is_cash),f.account_id,'All accounts',x=>x.code+' · '+x.name)}</select></label>`;
  html+='<button type="submit" class="btn btn-ghost">Apply filters</button>';
  $('finance-filters').innerHTML=`<form class="finance-filter-bar" id="finance-filter-form">${html}</form>`;
 }
 function pager(data){return `<div class="finance-pager"><span>${data.total?state.page*state.pageSize+1:0}–${Math.min((state.page+1)*state.pageSize,data.total)} of ${data.total}</span><div>${state.page?btn('← Previous','previous'):''}${(state.page+1)*state.pageSize<data.total?btn('Next →','next'):''}</div></div>`;}
 function listArgs(extra={}){return {...filter(),...extra,limit:state.pageSize,offset:state.page*state.pageSize};}
 function card(label,value,sub='',accent=false){return `<div class="finance-card ${accent?'accent':''}"><div class="finance-card-label">${E(label)}</div><div class="finance-card-value">${E(value)}</div><div class="finance-card-sub">${E(sub)}</div></div>`;}
 function profit(r){const income=total(r.period.filter(x=>x.account_type==='income').map(x=>-Number(x.net)));const expense=total(r.period.filter(x=>x.account_type==='expense').map(x=>x.net));return {income,expense,profit:C.decimal(C.scaled(income)-C.scaled(expense))};}
 function categoryBars(categories){const max=Math.max(1,...categories.map(x=>Math.abs(Number(x.amount))));return categories.length?`<div class="finance-panel-body">${categories.map(x=>`<div class="finance-bar-row"><div class="finance-bar-label"><span>${E(x.name)}</span><strong>${money(x.amount)}</strong></div><div class="finance-bar-track"><div class="finance-bar-fill" style="width:${Math.min(100,Math.abs(Number(x.amount))/max*100)}%"></div></div></div>`).join('')}</div>`:empty('No expenses yet','Expense categories will appear as transactions are recorded.');}
 function cashCards(r){const rows=r.balances.filter(x=>x.is_cash);return `<div class="finance-grid">${rows.map(x=>card(x.name,money(x.net),`Balance as of ${date(r.to)}`)).join('')}</div>`;}
 function currentAging(r,limit){let rows=r.outstanding.aging;if(limit)rows=rows.slice(0,limit);return rows.length?table([['Document'],['Contact'],['Due'],['Outstanding',1],['Overdue']],rows.map(x=>`<tr><td><button class="finance-link" data-action="document" data-id="${x.id}">${E(x.number)}</button><span class="muted">${x.kind==='invoice'?'Client invoice':'Supplier bill'}</span></td><td>${E(x.contact_name)}</td><td>${date(x.due_date)}</td><td class="numeric">${money(x.outstanding,x.currency)}</td><td>${E(x.aging_bucket)}</td></tr>`)):empty('Nothing outstanding','All issued invoices and bills are settled.');}
 function renderOverview(r){
  const p=profit(r);const cash=total(r.balances.filter(x=>x.is_cash).map(x=>x.net));
  const cards=`<div class="finance-grid">${card('Booked income',money(p.income),'Accrual income for the selected dates',true)}${card('Booked expenses',money(p.expense),'Includes supplier bills and adjustments')}${card('Net profit / loss',money(p.profit),'Income less expenses')}${card('Cash & bank',money(cash),`Balance as of ${date(r.to)}`)}</div><div class="finance-grid">${card('Clients owe',money(r.outstanding.receivable),'Current unpaid invoice balances')}${card('Firm owes',money(r.outstanding.payable),'Current unpaid supplier balances')}${card('Overdue invoices',money(r.outstanding.overdue_receivable),'Current past-due client balances')}${card('Cash movement',money(Number(r.cash.cash_in)-Number(r.cash.cash_out)),'Cash in less cash out; includes transfers')}</div>`;
  const actions=canEdit()?btn('+ New invoice','new_invoice','',true)+btn('+ Add expense','new_expense')+btn('+ Supplier bill','new_bill'):'';
  const max=Math.max(1,...r.trend.flatMap(x=>[Number(x.income),Number(x.expense)]));
  const trend=r.trend.length?`<div class="finance-panel-body"><p class="finance-small">Orange: income · Purple: expenses (${base()})</p>${r.trend.map(x=>`<div class="finance-trend-row"><span>${E(x.month)}</span><div class="finance-trend-bars"><span style="background:var(--c-accent);width:${Math.max(0,Number(x.income))/max*100}%"></span><span style="background:#8077da;width:${Math.max(0,Number(x.expense))/max*100}%"></span></div><span class="numeric">${money(Number(x.income)-Number(x.expense))}</span></div>`).join('')}</div>`:empty('Start your books','Record an opening balance, your first invoice, or an expense.');
  return `<div class="finance-toolbar" style="margin-bottom:20px">${actions}</div>${cards}<div class="finance-split">${panel('Expenses by category',categoryBars(r.expense_categories))}${panel('Income & expenses by month',trend)}</div>${panel('Current outstanding invoices & bills',currentAging(r,10),btn('See reports','go_reports'),'Outstanding balances show the latest state, regardless of the date filter.')}`;
 }
 function renderDocuments(data,kind){
  const title=kind==='invoice'?'Client invoices':'Supplier bills',action=kind==='invoice'?'new_invoice':'new_bill';
  const actions=btn('Export CSV','export_list')+(canEdit()?btn('+ '+(kind==='invoice'?'New invoice':'New bill'),action,'',true):'');
  const body=data.rows.length?table([['Number / reference'],[kind==='invoice'?'Client':'Supplier'],['Issued'],['Due'],['Total',1],['Outstanding',1],['Status'],['Actions']],data.rows.map(d=>`<tr><td><button class="finance-link" data-action="document" data-id="${d.id}">${E(d.number||'Draft')}</button>${d.reference?`<span class="muted">${E(d.reference)}</span>`:''}${d.is_opening?'<span class="muted">Opening balance</span>':''}</td><td>${E(d.contact_name)}</td><td>${date(d.issue_date)}</td><td>${date(d.due_date)}</td><td class="numeric">${money(d.total,d.currency)}</td><td class="numeric">${d.state==='void'?'—':money(d.outstanding,d.currency)}</td><td>${badge(d.status)}${d.is_overdue&&d.status==='partial'?'<span class="muted">Past due</span>':''}</td><td class="actions">${btn('View','document',d.id)}${btn('PDF ↓','pdf_document',d.id)}</td></tr>`)):empty('No matching '+(kind==='invoice'?'invoices':'bills'),'Create a document or adjust the search and date filters.');
  return panel(title,body+pager(data),actions,'Draft → issued → unpaid / partially paid / paid. Payments control the status.');
 }
 function renderExpenses(data){
  const actions=btn('Export CSV','export_list')+(canEdit()?btn('+ Add expense','new_expense','',true):'');
  const body=data.rows.length?table([['Date'],['Description'],['Category'],['Paid from'],['Amount',1],[`Book amount (${base()})`,1],['Status'],['Actions']],data.rows.map(x=>`<tr><td>${date(x.expense_date)}</td><td>${E(x.description)}${x.contact_name?`<span class="muted">${E(x.contact_name)}</span>`:''}${x.reference?`<span class="muted">${E(x.reference)}</span>`:''}</td><td>${E(x.category_name)}</td><td>${E(x.cash_name)}</td><td class="numeric">${money(x.amount,x.currency)}</td><td class="numeric">${money(x.base_amount)}</td><td>${badge(x.state)}</td><td class="actions">${btn('Details','expense',x.id)}${canEdit()&&x.state==='posted'?btn('Correct','correct_expense',x.id)+btn('Void','void_expense',x.id):''}</td></tr>`)):empty('No matching expenses','Add an expense, or change the category and date filters.');
  return panel('Expenses',`<div class="finance-panel-body finance-small">Filtered active expenses: <strong>${money(data.base_total)}</strong></div>`+body+pager(data),actions,'Expenses paid immediately. Use supplier bills for purchases payable later.');
 }
 function renderContacts(data){return panel('Clients & suppliers',(data.rows.length?table([['Name'],['Type'],['Email / phone'],['Status'],['Actions']],data.rows.map(x=>`<tr><td>${E(x.name)}${x.address?`<span class="muted">${E(x.address)}</span>`:''}</td><td>${E(x.contact_type)}</td><td>${E(x.email||'—')}<span class="muted">${E(x.phone)}</span></td><td>${x.is_active?'Active':'Archived'}</td><td class="actions">${btn('Statement','statement',x.id)}${canEdit()?btn('Edit','edit_contact',x.id):''}</td></tr>`)):empty('Add your first contact','Clients receive invoices; suppliers provide goods or services.'))+pager(data),btn('Export CSV','export_list')+(canEdit()?btn('+ Add contact','new_contact','',true):''));}
 function renderBanking(r){return cashCards(r)+panel('Chart of accounts',table([['Code'],['Account'],['Type'],[`Balance (${base()})`,1],['Status'],['Actions']],r.balances.map(x=>`<tr><td>${E(x.code)}</td><td>${E(x.name)}${x.is_cash?'<span class="muted">Cash / bank account</span>':''}</td><td>${E(x.account_type)}</td><td class="numeric">${money(['liability','equity','income'].includes(x.account_type)?-Number(x.net):x.net)}</td><td>${account(x.id)?.is_active?'Active':'Archived'}</td><td class="actions">${btn('Ledger','account_ledger',x.id)}${canEdit()?btn('Edit','edit_account',x.id):''}</td></tr>`)),canEdit()?btn('+ New account','new_account','',true)+btn('Transfer funds','new_transfer')+btn('Opening balance / journal','new_journal'):'','Balances use the base currency. Record assets, loans, capital and drawings through a balanced journal.');}
 function renderLedger(data){const f=filter();return panel('General ledger',`<div class="finance-panel-body finance-small">Debits: <strong>${money(data.debit)}</strong> · Credits: <strong>${money(data.credit)}</strong>${f.account_id?` · Opening net debit balance: <strong>${money(data.opening)}</strong> · Closing net debit balance: <strong>${money(Number(data.opening)+Number(data.debit)-Number(data.credit))}</strong>`:''}</div>`+(data.rows.length?table([['Date'],['Description'],['Account'],['Debit',1],['Credit',1],['Source'],['Actions']],data.rows.map(x=>`<tr><td>${date(x.entry_date)}</td><td>${E(x.description)}${x.is_reversed?'<span class="muted">Reversed; original retained</span>':''}</td><td>${E(x.account_code)} · ${E(x.account_name)}</td><td class="numeric">${Number(x.debit)?money(x.debit):'—'}</td><td class="numeric">${Number(x.credit)?money(x.credit):'—'}</td><td>${E(x.source_type)}</td><td>${canEdit()&&['manual','transfer'].includes(x.source_type)&&!x.is_reversed?btn('Reverse','reverse_journal',x.journal_id):''}</td></tr>`)):empty('No matching ledger entries','Issued documents, payments and expenses create entries automatically.'))+pager(data),btn('Export CSV','export_list')+(canEdit()?btn('+ Journal','new_journal','',true):''),'Posted entries remain in history. Corrections create equal and opposite entries.');}
 function renderAudit(data){return panel('Accounts audit trail',(data.rows.length?table([['When'],['User'],['Action'],['Details']],data.rows.map(x=>`<tr><td>${E(new Date(x.created_at).toLocaleString('en-GB',{timeZone:state.boot.settings.timezone}))}</td><td>${E(x.actor_name)}</td><td>${E(x.action.replaceAll('_',' '))}</td><td><details><summary>View details</summary><pre class="finance-pre">${E(JSON.stringify(x.details,null,2))}</pre></details></td></tr>`)):empty('No activity yet','Changes to accounts are logged automatically.'))+pager(data),btn('Export CSV','export_list'));}
 function reportData(r,kind){
  const p=profit(r),headers=['Account',`Amount (${base()})`];let rows=[],title='',sub='';
  const natur=x=>['liability','equity','income'].includes(x.account_type)?-Number(x.net):Number(x.net);
  if(kind==='profit_loss'){
   title='Profit & loss';sub=`${date(r.from)} to ${date(r.to)} · Accrual basis`;
   rows=[['INCOME',''],...r.period.filter(x=>x.account_type==='income'&&Number(x.net)).map(x=>[x.name,money(-Number(x.net))]),['Total income',money(p.income)],['EXPENSES',''],...r.period.filter(x=>x.account_type==='expense'&&Number(x.net)).map(x=>[x.name,money(x.net)]),['Total expenses',money(p.expense)],['NET PROFIT / LOSS',money(p.profit)]];
  }else if(kind==='trial_balance'){
   title='Trial balance';sub=`As of ${date(r.to)} · Net account balances`;headers.splice(0,2,'Code','Account','Debit','Credit');
   let deb=0n,cred=0n;rows=r.balances.filter(x=>Number(x.net)).map(x=>{const n=C.scaled(x.net);deb+=n>0n?n:0n;cred+=n<0n?-n:0n;return [x.code,x.name,n>0n?money(x.net):'—',n<0n?money(-Number(x.net)):'—'];});rows.push(['','TOTAL',money(C.decimal(deb)),money(C.decimal(cred))]);sub+=' · '+(deb===cred?'Balanced':'Check imbalance');
  }else if(kind==='balance_sheet'){
   title='Balance sheet';sub=`As of ${date(r.to)}`;
   const assets=total(r.balances.filter(x=>x.account_type==='asset').map(x=>x.net)),liabilities=total(r.balances.filter(x=>x.account_type==='liability').map(x=>-Number(x.net)));
   const equity=total(r.balances.filter(x=>x.account_type==='equity').map(x=>-Number(x.net)));
   const earnings=total(r.balances.filter(x=>['income','expense'].includes(x.account_type)).map(x=>-Number(x.net)));
   rows=[['ASSETS',''],...r.balances.filter(x=>x.account_type==='asset'&&Number(x.net)).map(x=>[x.name,money(natur(x))]),['Total assets',money(assets)],['LIABILITIES',''],...r.balances.filter(x=>x.account_type==='liability'&&Number(x.net)).map(x=>[x.name,money(natur(x))]),['Total liabilities',money(liabilities)],['EQUITY',''],...r.balances.filter(x=>x.account_type==='equity'&&Number(x.net)).map(x=>[x.name,money(natur(x))]),['Accumulated earnings (unclosed)',money(earnings)],['Total equity',money(total([equity,earnings]))],['LIABILITIES + EQUITY',money(total([liabilities,equity,earnings]))]];
  }else if(kind==='expenses'){
   title='Expenses by category';sub=`${date(r.from)} to ${date(r.to)} · Includes bills and ledger adjustments`;rows=r.expense_categories.map(x=>[x.name,money(x.amount)]);rows.push(['TOTAL',money(p.expense)]);
  }else if(kind==='cash'){
   title='Cash & bank movements';sub=`${date(r.from)} to ${date(r.to)} · Includes transfers and reversals`;
   rows=[['Cash in',money(r.cash.cash_in)],['Cash out',money(r.cash.cash_out)],['Net movement',money(Number(r.cash.cash_in)-Number(r.cash.cash_out))],['BALANCES AS OF '+date(r.to),''],...r.balances.filter(x=>x.is_cash).map(x=>[x.name,money(x.net)])];
  }else{
   title='Current receivables & payables';sub=`Current balances as of ${date(r.today)}; not restricted by the report date range.`;
   headers.splice(0,2,'Document','Type','Contact','Due','Outstanding','Book amount','Aging');rows=r.outstanding.aging.map(x=>[x.number,x.kind,x.contact_name,date(x.due_date),money(x.outstanding,x.currency),money(x.base_outstanding),x.aging_bucket]);
  }
  return {title,sub,headers,rows};
 }
 function renderReports(r){const kinds={profit_loss:'Profit & loss',balance_sheet:'Balance sheet',trial_balance:'Trial balance',expenses:'Expenses by category',cash:'Cash & bank movements',aging:'Current receivables & payables'};const data=reportData(r,state.reportKind);return panel(data.title,`<div class="finance-panel-body finance-small">${E(data.sub)}</div>`+table(data.headers.map((h,i)=>[h,i>0&&state.reportKind!=='aging']),data.rows.map(row=>`<tr>${row.map((v,i)=>`<td${i>0&&state.reportKind!=='aging'?' class="numeric"':''}>${E(v)}</td>`).join('')}</tr>`)),`<select id="finance-report-kind" class="finance-report-selector" aria-label="Report type">${Object.entries(kinds).map(([k,v])=>`<option value="${k}"${state.reportKind===k?' selected':''}>${E(v)}</option>`).join('')}</select>`+btn('CSV ↓','export_report')+btn('PDF ↓','pdf_report'));}
 function renderAccess(data){return panel('Accounts permissions',`<div class="finance-panel-body finance-hint">View only allows searching and downloading. Editing allows financial changes. Only super admins can grant access. An inactive, unapproved or unconfirmed account cannot open accounts.</div>`+table([['Portal user'],['Portal role'],['Accounts access'],['Actions']],data.rows.map(x=>`<tr><td>${E(x.full_name)}<span class="muted">${E(x.email)}${!x.is_active?' · Inactive':''}${!x.confirmed?' · Email not confirmed':''}</span></td><td>${E(x.role)}</td><td>${x.role==='super_admin'?'Full access':`<select id="access-${x.id}" class="finance-access-select" aria-label="Accounts access for ${E(x.full_name)}"><option value="none"${x.level==='none'?' selected':''}>No access</option><option value="view"${x.level==='view'?' selected':''}>View only</option><option value="edit"${x.level==='edit'?' selected':''}>View & edit</option></select>`}</td><td>${x.role==='super_admin'?'Automatic':btn('Save access','save_access',x.id)}</td></tr>`)), '', 'Union Enterprises Pakistan can be assigned View only here without changing its portal role.');}
 async function loadSection(){
  const token=++state.renderToken,tab=state.tab;$('finance-content').setAttribute('aria-busy','true');$('finance-content').innerHTML='<div class="loading-wrap"><div class="spinner"></div> Loading…</div>';
  try{
   let html,data;
   if(['overview','reports','banking'].includes(tab)){data=await api('report',filter());state.report=data;html=tab==='overview'?renderOverview(data):tab==='reports'?renderReports(data):renderBanking(data);}
   else if(['invoices','bills'].includes(tab)){data=await api('list_documents',listArgs({kind:tab==='invoices'?'invoice':'bill'}));html=renderDocuments(data,tab==='invoices'?'invoice':'bill');}
   else if(tab==='expenses'){data=await api('list_expenses',listArgs());html=renderExpenses(data);}
   else if(tab==='contacts'){data=await api('list_contacts',listArgs());html=renderContacts(data);}
   else if(tab==='ledger'){data=await api('list_ledger',listArgs());html=renderLedger(data);}
   else if(tab==='audit'){data=await api('list_audit',listArgs());html=renderAudit(data);}
   else if(tab==='access'){data=await api('list_access');html=renderAccess(data);}
   else html=settingsForm();
   if(token!==state.renderToken||tab!==state.tab)return;
   state.rows=data?.rows||[];$('finance-content').innerHTML=html;fitAmounts();
   if(tab==='settings')bindSettings();
  }catch(error){if(token===state.renderToken)$('finance-content').innerHTML=empty('Could not load this section',error.message,btn('Try again','retry'));}
  finally{if(token===state.renderToken)$('finance-content').setAttribute('aria-busy','false');}
 }
 function go(tab){if(!titles[tab]||(['access','settings'].includes(tab)&&!isAdmin()))return;state.tab=tab;state.page=0;history.replaceState(null,'','#'+tab);buildTabs();buildFilters();loadSection();}
 async function refresh(){state.boot=await api('bootstrap');$('finance-business').textContent=state.boot.settings.business_name;buildTabs();buildFilters();await loadSection();}
 async function refreshAccess(){
  try{const a=await api('access');if(a.level==='none'){state.renderToken++;state.boot=null;state.rows=[];state.report=null;$('finance-app').classList.add('hidden');if($('finance-dialog').open)$('finance-dialog').close();$('finance-error').classList.remove('hidden');$('finance-error').innerHTML='<h2>Accounts access is unavailable</h2><p>Ask a super admin to grant access, or confirm that your account is active and your email is verified.</p><a href="leads.html">Return to portal</a>';return;}
   if(state.boot&&a.level!==state.boot.level){state.boot.level=a.level;if($('finance-dialog').open)$('finance-dialog').close();go('overview');updateAccessLabel();}
  }catch(error){console.warn('Accounts access check failed:',error.message);}
 }
 function updateAccessLabel(){$('finance-access').textContent=state.boot.level==='admin'?'Super admin · full access':canEdit()?'View & edit':'View only';}
 function fitAmounts(){
  document.querySelectorAll('.finance-card-value').forEach(el=>{
   el.style.fontSize='';let size=parseFloat(getComputedStyle(el).fontSize);
   while(el.scrollWidth>el.clientWidth&&size>10){size-=.5;el.style.fontSize=size+'px';}
  });
 }
 window.addEventListener('resize',fitAmounts);
 document.fonts?.ready.then(fitAmounts);
 function field(name,label,value='',type='text',extra=''){
  return `<label class="finance-field ${type==='textarea'?'full':''}">${E(label)}${type==='textarea'?`<textarea name="${name}" ${extra}>${E(value)}</textarea>`:`<input name="${name}" type="${type}" value="${E(value)}" ${extra}>`}</label>`;
 }
 function select(name,label,html){return `<label class="finance-field">${E(label)}<select name="${name}" required>${html}</select></label>`;}
 function currencyFields(cur=base(),fx='1'){
  return select('currency','Transaction currency',['PKR','USD'].map(x=>`<option value="${x}"${cur===x?' selected':''}>${x}</option>`).join(''))+field('exchange_rate',`1 transaction unit = how many ${base()}?`,fx,'number','required min="0.00000001" step="0.00000001"');
 }
 function formShell(body,label='Save',extra=''){return `<form id="finance-modal-form" class="finance-form"><div class="finance-form-error hidden" role="alert" data-error></div>${body}<div class="finance-form-actions"><button type="button" class="btn btn-ghost" data-action="close_dialog">Cancel</button>${extra}<button type="submit" class="btn btn-primary" id="finance-modal-save">${E(label)}</button></div></form>`;}
 function openModal(title,html){$('finance-dialog-title').textContent=title;$('finance-dialog-body').innerHTML=html;if(!$('finance-dialog').open)$('finance-dialog').showModal();$('finance-dialog-body').querySelector('input,select,textarea,button')?.focus();}
 function closeModal(){if(!state.dialogBusy)$('finance-dialog').close();}
 async function changed(message='Saved.'){showToast(message,'success');try{await refresh();}catch(e){showToast('Saved, but the display could not refresh. Use Refresh.','error');}}
 function bindModal(handler){
  const form=$('finance-modal-form'),requestId=C.uuid();
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(state.dialogBusy||!form.reportValidity())return;
   const error=form.querySelector('[data-error]');error.classList.add('hidden');
   state.dialogBusy=true;form.querySelectorAll('button').forEach(x=>x.disabled=true);$('finance-dialog-close').disabled=true;
   try{await handler(new FormData(form),requestId,event.submitter);$('finance-dialog').close();await changed();}
   catch(e){error.textContent=e.message;error.classList.remove('hidden');error.scrollIntoView({block:'nearest'});}
   finally{state.dialogBusy=false;form.querySelectorAll('button').forEach(x=>x.disabled=false);$('finance-dialog-close').disabled=false;}
  });
  wireCurrency(form);
 }
 function wireCurrency(form){
  const cur=form.elements.currency,fx=form.elements.exchange_rate;
  if(!cur||!fx)return;
  const adjust=()=>{if(cur.value===base()){fx.value='1';fx.readOnly=true;}else{if(fx.readOnly)fx.value='';fx.readOnly=false;}};cur.addEventListener('change',adjust);adjust();
 }
 const object=form=>Object.fromEntries(form.entries());
 function contactForm(existing){
  if(!canEdit())return;const x=existing||{};
  openModal(existing?'Edit contact':'Add client / supplier',formShell(`<div class="finance-form-grid">${field('name','Name',x.name||'','text','required maxlength="200"')}${select('contact_type','Contact type',['client','supplier','both'].map(v=>`<option value="${v}"${(x.contact_type||'client')===v?' selected':''}>${v==='both'?'Client & supplier':v.charAt(0).toUpperCase()+v.slice(1)}</option>`).join(''))}${field('email','Email',x.email||'','email','maxlength="200"')}${field('phone','Phone',x.phone||'','text','maxlength="80"')}${field('tax_id','Tax / registration ID',x.tax_id||'','text','maxlength="120"')}${field('address','Billing address',x.address||'','textarea','maxlength="1500"')}${field('notes','Notes',x.notes||'','textarea','maxlength="2000"')}</div><label class="finance-check"><input type="checkbox" name="is_active"${x.is_active!==false?' checked':''}>Active contact</label>`));
  bindModal((f,key)=>write('save_contact',{...object(f),id:x.id,is_active:f.has('is_active')},key));
 }
 function accountForm(existing){
  if(!canEdit())return;const x=existing||{};
  openModal(existing?'Edit account':'Add account',formShell(`<div class="finance-hint">Cash and bank accounts use ${base()}. Document payments can use PKR or USD and a recorded settlement rate.</div><div class="finance-form-grid">${field('code','Account code',x.code||'','text',`required maxlength="20" pattern="[A-Za-z0-9-]+"${x.system_key?' readonly':''}`)}${field('name','Account name',x.name||'','text','required maxlength="200"')}${select('account_type','Account type',['asset','liability','equity','income','expense'].map(v=>`<option value="${v}"${(x.account_type||'asset')===v?' selected':''}>${v.charAt(0).toUpperCase()+v.slice(1)}</option>`).join(''))}</div><label class="finance-check"><input type="checkbox" name="is_cash"${x.is_cash?' checked':''}>Cash / bank account</label><label class="finance-check"><input type="checkbox" name="is_active"${x.is_active!==false?' checked':''}>Active account</label>`));
  const f=$('finance-modal-form');if(x.system_key){f.elements.account_type.disabled=true;f.elements.is_cash.disabled=true;f.elements.is_active.disabled=true;}
  bindModal((fd,key)=>write('save_account',{...object(fd),id:x.id,account_type:x.system_key?x.account_type:fd.get('account_type'),is_cash:x.system_key?x.is_cash:fd.has('is_cash'),is_active:x.system_key?x.is_active:fd.has('is_active')},key));
 }
 function documentForm(kind,existing){
  if(!canEdit())return;const x=existing||{},isInvoice=kind==='invoice';
  const contacts=state.boot.contacts.filter(c=>c.is_active&&['both',isInvoice?'client':'supplier'].includes(c.contact_type));
  if(!contacts.length){openModal('Add a contact first',`<div class="finance-dialog-body">${empty('A '+(isInvoice?'client':'supplier')+' is required','Create the billing contact first, then return to create this document.',btn('+ Add contact','new_contact','',true))}</div>`);return;}
  const cur=x.currency||base();
  openModal((existing?'Edit draft ':isInvoice?'Create ':'Create supplier ')+(isInvoice?'invoice':'bill'),formShell(`<div class="finance-form-grid">${select('contact_id',isInvoice?'Bill to client':'Supplier',options(contacts,x.contact_id,'Choose '+(isInvoice?'client':'supplier')))}${field('reference','Reference / PO / supplier number',x.reference||'','text','maxlength="200"')}${field('issue_date','Document date',x.issue_date||state.boot.today,'date','required')}${field('due_date','Due date',x.due_date||state.boot.today,'date','required')}${currencyFields(cur,x.exchange_rate||'1')}</div><div class="finance-hint">Amounts are in the selected transaction currency. Discounts apply before tax. Tax rates are entered manually.${isInvoice?' Issuing an invoice makes it unpaid; record payments to mark it paid.':' Issuing a bill creates a supplier balance; record payments when you pay it.'}</div><div class="finance-lines"><table class="finance-line-table"><thead><tr><th>Description</th><th>Account</th><th>Qty</th><th>Price</th><th>Disc %</th><th>Tax %</th><th>Total</th><th></th></tr></thead><tbody id="finance-doc-lines"></tbody></table></div><div style="margin-top:12px">${btn('+ Add line','add_doc_line')}</div><div id="finance-doc-totals" class="finance-total-box"></div><label class="finance-check"><input type="checkbox" name="is_opening"${x.is_opening?' checked':''}>Opening receivable / payable from previous books (posts to opening equity)</label>${field('notes','Notes / terms',x.notes??state.boot.settings.default_terms,'textarea','maxlength="4000"')}`,'Save draft','<button type="submit" class="btn btn-primary" name="mode" value="issue">Save & issue</button>'));
  const items=x.items||[{description:'',quantity:'1',rate:'0',discount_pct:'0',tax_pct:'0',account_id:state.boot.accounts.find(a=>a.system_key===(isInvoice?'revenue':'other_expense'))?.id}];
  for(const item of items)addDocumentLine(kind,item);
  const form=$('finance-modal-form');form.dataset.kind=kind;form.addEventListener('input',updateDocumentTotals);form.addEventListener('change',updateDocumentTotals);updateDocumentTotals();
  bindModal((f,key,submitter)=>write('save_document',{...object(f),kind,id:x.id,version:x.version,is_opening:f.has('is_opening'),items:readDocumentLines(),issue_now:submitter?.value==='issue'},key));
 }
 function addDocumentLine(kind,item={}){
  const accounts=state.boot.accounts.filter(a=>a.is_active&&(kind==='invoice'?a.account_type==='income':a.account_type==='expense'||(a.account_type==='asset'&&!a.is_cash&&!['receivable','tax_receivable'].includes(a.system_key))));
  const row=document.createElement('tr');row.className='finance-line';
  row.innerHTML=`<td class="line-desc"><input data-line="description" value="${E(item.description||'')}" placeholder="Service or item" required maxlength="500" aria-label="Line description"></td><td class="line-account"><select data-line="account_id" required aria-label="Line account">${options(accounts,item.account_id||accounts[0]?.id,'Choose account',a=>a.name)}</select></td><td class="line-qty"><input data-line="quantity" type="number" step="0.001" min="0.001" value="${E(item.quantity??'1')}" required aria-label="Quantity"></td><td class="line-rate"><input data-line="rate" type="number" step="0.01" min="0" value="${E(item.rate??'0')}" required aria-label="Unit price"></td><td class="line-percent"><input data-line="discount_pct" type="number" step="0.001" min="0" max="100" value="${E(item.discount_pct??'0')}" required aria-label="Discount percent"></td><td class="line-percent"><input data-line="tax_pct" type="number" step="0.001" min="0" max="100" value="${E(item.tax_pct??'0')}" required aria-label="Tax percent"></td><td><span class="finance-line-total">—</span></td><td><button type="button" class="btn btn-ghost btn-sm" data-action="remove_doc_line" aria-label="Remove line">✕</button></td>`;
  $('finance-doc-lines').append(row);
 }
 function readDocumentLines(){return [...$('finance-doc-lines').querySelectorAll('tr')].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-line]')].map(el=>[el.dataset.line,el.value])));}
 function updateDocumentTotals(){
  if(!$('finance-doc-lines'))return;
  const items=readDocumentLines(),cur=$('finance-modal-form').elements.currency.value;
  [...$('finance-doc-lines').children].forEach((row,i)=>{try{row.querySelector('.finance-line-total').textContent=money(C.line(items[i]).total,cur);}catch(e){row.querySelector('.finance-line-total').textContent='Check amounts';}});
  try{const x=C.totals(items);$('finance-doc-totals').innerHTML=`<dl><div><dt>Subtotal</dt><dd>${money(x.subtotal,cur)}</dd></div><div><dt>Discount</dt><dd>− ${money(x.discount_total,cur)}</dd></div><div><dt>Tax</dt><dd>${money(x.tax_total,cur)}</dd></div><div class="grand"><dt>Total</dt><dd>${money(x.total,cur)}</dd></div></dl>`;}catch(e){$('finance-doc-totals').innerHTML='<p class="finance-small">Check all line quantities and amounts.</p>';}
 }
 function expenseForm(existing){
  if(!canEdit())return;const x=existing||{},correct=Boolean(existing);
  const expenseDate=correct&&state.boot.settings.closed_through&&x.expense_date<=state.boot.settings.closed_through?state.boot.today:x.expense_date||state.boot.today;
  openModal(correct?'Correct expense':'Record expense',formShell(`${correct?'<div class="finance-hint">The original expense is reversed and a replacement is posted in one transaction. Both remain in the audit trail.</div>':''}<div class="finance-form-grid">${field('description','Description',x.description||'','text','required maxlength="500"')}${field('expense_date','Expense date',expenseDate,'date','required')}${select('category_id','Expense category',accountOptions(x.category_id,'expense'))}${select('cash_account_id','Paid from',cashOptions(x.cash_account_id))}${field('amount','Total amount (including any non-recoverable tax)',x.amount||'','number','required min="0.01" step="0.01"')}${currencyFields(x.currency||base(),x.exchange_rate||'1')}<label class="finance-field">Contact (optional)<select name="contact_id">${options(state.boot.contacts.filter(c=>c.is_active),x.contact_id,'No contact')}</select></label>${field('reference','Receipt / reference',x.reference||'','text','maxlength="200"')}${field('notes','Notes',x.notes||'','textarea','maxlength="2000"')}${correct?field('reversal_date','Original reversal date',state.boot.today,'date','required')+field('reason','Reason for correction','','text','required minlength="3" maxlength="500"'):''}</div>`));
  bindModal((f,key)=>write(correct?'replace_expense':'add_expense',{...object(f),id:x.id},key));
 }
 function transferForm(){if(!canEdit())return;openModal('Transfer cash / bank funds',formShell(`<div class="finance-form-grid">${select('from_account_id','From account',cashOptions())}${select('to_account_id','To account',cashOptions())}${field('amount',`Amount (${base()})`,'','number','required min="0.01" step="0.01"')}${field('date','Date',state.boot.today,'date','required')}${field('description','Reference / description','','text','maxlength="480"')}</div>`,'Record transfer'));bindModal((f,key)=>write('transfer',object(f),key));}
 function journalForm(){
  if(!canEdit())return;openModal('Opening balance / journal entry',formShell(`<div class="finance-hint">Enter balanced debits and credits in ${base()}. For example, opening bank funds: debit Bank, credit Opening balance equity or Owner capital. Use opening invoices / bills for amounts clients owe or suppliers are owed.</div><div class="finance-form-grid">${field('date','Posting date',state.boot.today,'date','required')}${field('description','Description','','text','required maxlength="500"')}</div><div class="finance-lines"><table class="finance-line-table"><thead><tr><th>Account</th><th>Debit</th><th>Credit</th><th></th></tr></thead><tbody id="finance-journal-lines"></tbody></table></div>${btn('+ Add line','add_journal_line')}<p class="finance-small" id="finance-journal-total" style="margin-top:14px"></p>`,'Post journal'));
  addJournalLine();addJournalLine();$('finance-modal-form').addEventListener('input',updateJournalTotals);updateJournalTotals();
  bindModal((f,key)=>write('post_journal',{...object(f),lines:readJournalLines()},key));
 }
 function addJournalLine(){const tr=document.createElement('tr');tr.className='finance-line';tr.innerHTML=`<td><select data-line="account_id" required aria-label="Journal account">${options(activeAccounts().filter(a=>!['receivable','payable'].includes(a.system_key)),undefined,'Choose account',a=>a.code+' · '+a.name)}</select></td><td><input type="number" min="0" step="0.01" value="0" data-line="debit" required aria-label="Debit"></td><td><input type="number" min="0" step="0.01" value="0" data-line="credit" required aria-label="Credit"></td><td><button type="button" class="btn btn-ghost btn-sm" data-action="remove_journal_line" aria-label="Remove journal line">✕</button></td>`;$('finance-journal-lines').append(tr);}
 function readJournalLines(){return [...$('finance-journal-lines').children].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-line]')].map(el=>[el.dataset.line,el.value])));}
 function updateJournalTotals(){try{const rows=readJournalLines(),debit=total(rows.map(x=>x.debit)),credit=total(rows.map(x=>x.credit));$('finance-journal-total').textContent=`Debit ${money(debit)} · Credit ${money(credit)} · ${debit===credit?'Balanced':'Difference '+money(C.decimal(C.scaled(debit)-C.scaled(credit)))}`;}catch(e){$('finance-journal-total').textContent='Check debit and credit amounts.';}}
 function reasonForm(title,action,id,explanation){
  if(!canEdit())return;openModal(title,formShell(`<div class="finance-hint">${E(explanation)}</div><div class="finance-form-grid">${field('date','Reversal date',state.boot.today,'date','required')}${field('reason','Reason','','textarea','required minlength="3" maxlength="500"')}</div>`,'Confirm reversal'));
  bindModal((f,key)=>write(action,{...object(f),id},key));
 }
 function paymentForm(d){
  if(!canEdit())return;openModal(d.kind==='invoice'?'Record client payment':'Pay supplier bill',formShell(`<div class="finance-hint">${E(d.number)} · Outstanding ${E(money(d.outstanding,d.currency))}. Status changes automatically when the balance is settled.</div><div class="finance-form-grid">${field('amount',`Payment amount (${d.currency})`,d.outstanding,'number',`required min="0.01" step="0.01" max="${d.outstanding}"`)}${select('cash_account_id',d.kind==='invoice'?'Deposit into':'Paid from',cashOptions())}${field('payment_date','Payment date',state.boot.today,'date',`required min="${d.issue_date}"`)}${field('exchange_rate',`1 ${d.currency} = how many ${base()} at settlement?`,d.exchange_rate,'number',`required min="0.00000001" step="0.00000001"${d.currency===base()?' readonly':''}`)}${field('reference','Payment reference','','text','maxlength="200"')}${field('notes','Notes','','textarea','maxlength="2000"')}</div>`,'Record payment'));
  bindModal((f,key)=>write('add_payment',{...object(f),document_id:d.id},key));
 }
 async function showDocument(id){
  const data=await api('get_document',{id}),d=data.document,s=d.issuer_snapshot,c=d.contact_snapshot;
  let actions=btn('Download PDF','pdf_document',id);
  if(canEdit()&&d.state==='draft')actions+=btn('Edit draft','edit_document',id)+btn('Issue','issue_document',id,'true')+btn('Delete draft','delete_draft',id);
  if(canEdit()&&d.state==='issued'){
   if(Number(d.outstanding)>0)actions+=btn(Number(d.amount_paid)>0?'Record payment':'Mark paid / record payment','payment',id,true);
   if(Number(d.amount_paid)>0)actions+=btn('Set unpaid','reset_payments',id);else actions+=btn('Void','void_document',id);
  }
  const lines=table([['Description'],['Qty',1],['Unit price',1],['Discount',1],['Tax',1],['Amount',1]],d.items.map(x=>`<tr><td>${E(x.description)}<span class="muted">${E(x.account_name)}</span></td><td class="numeric">${E(x.quantity)}</td><td class="numeric">${money(x.rate,d.currency)}</td><td class="numeric">${money(x.discount,d.currency)}<span class="muted">${E(x.discount_pct)}%</span></td><td class="numeric">${money(x.tax,d.currency)}<span class="muted">${E(x.tax_pct)}%</span></td><td class="numeric">${money(x.total,d.currency)}</td></tr>`));
  const payments=data.payments.length?table([['Date'],['Account / reference'],['Amount',1],['Status'],['Actions']],data.payments.map(p=>`<tr><td>${date(p.payment_date)}</td><td>${E(p.cash_name)}<span class="muted">${E(p.reference)}</span></td><td class="numeric">${money(p.amount,d.currency)}<span class="muted">${money(p.base_cash)} settled</span></td><td>${badge(p.reversed_at?'reversed':'posted')}</td><td>${canEdit()&&!p.reversed_at?btn('Reverse receipt','reverse_payment',p.id):''}</td></tr>`)):empty('No payments recorded','Record a payment to change the unpaid balance.');
  openModal(d.kind==='invoice'?'Invoice details':'Supplier bill details',`<div class="finance-dialog-body"><div class="finance-document-meta"><div><h3>${E(d.number||'Draft '+d.kind)}</h3><p>Issued ${date(d.issue_date)} · Due ${date(d.due_date)}${d.reference?' · '+E(d.reference):''}</p>${d.is_opening?'<p>Opening balance from previous books</p>':''}</div>${badge(d.status)}</div><div class="finance-detail-grid"><div><h3>From</h3><p>${E(s.business_name)}\n${E(s.address)}\n${E(s.email)}\n${E(s.phone)}</p></div><div><h3>${d.kind==='invoice'?'Bill to':'Supplier'}</h3><p>${E(c.name)}\n${E(c.address)}\n${E(c.email)}\n${E(c.phone)}</p></div></div>${lines}<div class="finance-total-box"><dl><div><dt>Subtotal</dt><dd>${money(d.subtotal,d.currency)}</dd></div><div><dt>Discount</dt><dd>− ${money(d.discount_total,d.currency)}</dd></div><div><dt>Tax</dt><dd>${money(d.tax_total,d.currency)}</dd></div><div class="grand"><dt>Total</dt><dd>${money(d.total,d.currency)}</dd></div><div><dt>Paid</dt><dd>${money(d.amount_paid,d.currency)}</dd></div><div><dt>Outstanding</dt><dd>${d.state==='void'?'Voided':money(d.outstanding,d.currency)}</dd></div></dl></div>${d.notes?`<div class="finance-hint" style="white-space:pre-wrap">${E(d.notes)}</div>`:''}${d.void_reason?`<p class="finance-small">Voided ${date(d.void_date)}: ${E(d.void_reason)}</p>`:''}<div class="finance-toolbar" style="margin:20px 0">${actions}</div><h3 style="font-size:16px;margin:20px 0 12px">Payments & reversals</h3>${payments}</div>`);
 }
 function showExpense(x){openModal('Expense details',`<div class="finance-dialog-body"><div class="finance-document-meta"><div><h3>${E(x.description)}</h3><p>${date(x.expense_date)}</p></div>${badge(x.state)}</div><div class="finance-detail-grid"><div><h3>Category / account</h3><p>${E(x.category_name)}\nPaid from ${E(x.cash_name)}\n${E(x.contact_name)}</p></div><div><h3>Amounts</h3><p>${E(money(x.amount,x.currency))}\nBook amount: ${E(money(x.base_amount))}\nExchange rate: ${E(x.exchange_rate)}</p></div></div><p class="finance-small">Reference: ${E(x.reference||'—')}</p><p style="white-space:pre-wrap;font-size:13px;margin:16px 0">${E(x.notes)}</p>${x.void_reason?`<div class="finance-hint">Voided ${date(x.void_date)}: ${E(x.void_reason)}</div>`:''}<div class="finance-toolbar">${canEdit()&&x.state==='posted'?btn('Correct expense','correct_expense',x.id)+btn('Void expense','void_expense',x.id):''}</div></div>`);}
 function settingsForm(){
  const s=state.boot.settings;
  return panel('Business & invoice settings',`<form id="finance-settings-form" class="finance-form"><div class="finance-form-error hidden" data-error role="alert"></div><div class="finance-form-grid">${field('business_name','Business name',s.business_name,'text','required maxlength="200"')}${field('tax_id','Tax / registration ID',s.tax_id,'text','maxlength="120"')}${field('email','Business email',s.email,'email','maxlength="200"')}${field('phone','Business phone',s.phone,'text','maxlength="80"')}${field('address','Business address',s.address,'textarea','maxlength="1500"')}${select('base_currency','Base currency',['PKR','USD'].map(v=>`<option value="${v}"${s.base_currency===v?' selected':''}>${v}</option>`).join(''))}${field('timezone','Accounting timezone',s.timezone,'text','required maxlength="80"')}${select('logo_path','PDF logo',`<option value="images/haulxify.webp"${s.logo_path==='images/haulxify.webp'?' selected':''}>Haulxify</option><option value="images/aims.webp"${s.logo_path==='images/aims.webp'?' selected':''}>AIMS</option><option value="images/Union.webp"${s.logo_path==='images/Union.webp'?' selected':''}>Union Enterprises Pakistan</option><option value=""${s.logo_path===''?' selected':''}>No logo</option>`)}${field('invoice_prefix','Invoice prefix',s.invoice_prefix,'text','required pattern="[A-Z0-9]{2,12}" maxlength="12"')}${field('bill_prefix','Bill prefix',s.bill_prefix,'text','required pattern="[A-Z0-9]{2,12}" maxlength="12"')}${field('closed_through','Lock books through (optional)',s.closed_through||'','date',`max="${state.boot.today}"`)}${field('payment_details','Invoice payment instructions',s.payment_details,'textarea','maxlength="2500"')}${field('default_terms','Default invoice / bill terms',s.default_terms,'textarea','maxlength="4000"')}</div><div class="finance-hint">Set the base currency before creating financial records. Once records exist, it is protected. Issued invoices retain their original business and billing details. A period lock prevents new postings and reversals on/before the selected date.</div><div class="finance-form-actions"><button type="submit" class="btn btn-primary">Save settings</button></div></form>`);
 }
 function bindSettings(){
  const form=$('finance-settings-form');let key=C.uuid();
  form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;const button=event.submitter,error=form.querySelector('[data-error]');button.disabled=true;error.classList.add('hidden');try{await write('save_settings',object(new FormData(form)),key);key=C.uuid();await changed('Settings saved.');}catch(e){error.textContent=e.message;error.classList.remove('hidden');}finally{button.disabled=false;}});
 }
 function saveDownload(filename,text,type='text/csv;charset=utf-8'){
  const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
 }
 async function allRows(action,args={}){
  const rows=[];let offset=0;
  while(true){const data=await api(action,{...args,limit:500,offset});rows.push(...data.rows);offset+=data.rows.length;if(offset>=data.total||!data.rows.length)break;}
  return rows;
 }
 async function exportList(){
  const tab=state.tab;let action,headers,mapper,extra={};
  if(['invoices','bills'].includes(tab)){action='list_documents';extra.kind=tab==='invoices'?'invoice':'bill';headers=['Number','Contact','Issued','Due','Currency','FX rate','Subtotal','Discount','Tax','Total','Paid','Outstanding','Book outstanding','Status','Reference'];mapper=x=>[x.number||'Draft',x.contact_name,x.issue_date,x.due_date,x.currency,x.exchange_rate,x.subtotal,x.discount_total,x.tax_total,x.total,x.amount_paid,x.outstanding,x.base_outstanding,x.status,x.reference];}
  else if(tab==='expenses'){action='list_expenses';headers=['Date','Description','Category','Paid from','Contact','Currency','FX rate','Amount','Book amount','Status','Reference','Notes'];mapper=x=>[x.expense_date,x.description,x.category_name,x.cash_name,x.contact_name,x.currency,x.exchange_rate,x.amount,x.base_amount,x.state,x.reference,x.notes];}
  else if(tab==='contacts'){action='list_contacts';headers=['Name','Type','Email','Phone','Address','Tax ID','Active','Notes'];mapper=x=>[x.name,x.contact_type,x.email,x.phone,x.address,x.tax_id,x.is_active,x.notes];}
  else if(tab==='ledger'){action='list_ledger';headers=['Date','Description','Account code','Account','Type','Debit','Credit','Source','Journal ID','Reversed'];mapper=x=>[x.entry_date,x.description,x.account_code,x.account_name,x.account_type,x.debit,x.credit,x.source_type,x.journal_id,x.is_reversed];}
  else if(tab==='audit'){action='list_audit';headers=['When','User','Action','Entity','Details'];mapper=x=>[x.created_at,x.actor_name,x.action,x.entity_id,JSON.stringify(x.details)];}
  else return;
  const rows=await allRows(action,{...filter(),...extra});saveDownload(`haulxify-${tab}-${state.boot.today}.csv`,C.csv(headers,rows.map(mapper)));showToast(`Exported ${rows.length} records.`,'success');
 }
 async function showStatement(id){
  const c=contact(id);if(!c)return;
  const rows=[...await allRows('list_documents',{contact_id:id,kind:'invoice'}),...await allRows('list_documents',{contact_id:id,kind:'bill'})].sort((a,b)=>a.issue_date.localeCompare(b.issue_date));
  const data={title:'Statement — '+c.name,sub:'Current invoice and bill balances · '+date(state.boot.today),headers:['Document','Type','Date','Total','Paid','Outstanding','Status'],rows:rows.map(x=>[x.number||'Draft',x.kind,date(x.issue_date),money(x.total,x.currency),money(x.amount_paid,x.currency),x.state==='void'?'—':money(x.outstanding,x.currency),x.status])};
  openModal('Client / supplier statement',`<div class="finance-dialog-body"><h3>${E(c.name)}</h3><p class="finance-small" style="margin:8px 0 18px">${E(c.email)} · ${E(c.phone)}</p>${table(data.headers.map(x=>[x]),data.rows.map(row=>`<tr>${row.map(x=>`<td>${E(x)}</td>`).join('')}</tr>`))}<div class="finance-toolbar" style="margin-top:18px"><button type="button" class="btn btn-primary" id="finance-statement-pdf">Download statement PDF</button><button type="button" class="btn btn-ghost" id="finance-statement-csv">Download CSV</button></div></div>`);
  $('finance-statement-pdf').onclick=()=>FinancePDF.report(data,state.boot.settings);
  $('finance-statement-csv').onclick=()=>saveDownload('contact-statement-'+state.boot.today+'.csv',C.csv(data.headers,data.rows));
 }
 async function action(name,id,element){
  const row=state.rows.find(x=>x.id===id);
  if(name==='close_dialog')return closeModal();
  if(name==='retry')return loadSection();
  if(name==='previous'){state.page=Math.max(0,state.page-1);return loadSection();}
  if(name==='next'){state.page++;return loadSection();}
  if(name==='go_reports')return go('reports');
  if(name==='account_ledger'){go('ledger');filter().account_id=id;buildFilters();return loadSection();}
  if(name==='new_contact')return contactForm();
  if(name==='edit_contact')return contactForm(contact(id));
  if(name==='new_account')return accountForm();
  if(name==='edit_account')return accountForm(account(id));
  if(name==='new_invoice')return documentForm('invoice');
  if(name==='new_bill')return documentForm('bill');
  if(name==='new_expense')return expenseForm();
  if(name==='correct_expense')return expenseForm(row);
  if(name==='expense')return showExpense(row);
  if(name==='new_transfer')return transferForm();
  if(name==='new_journal')return journalForm();
  if(name==='add_doc_line'){addDocumentLine($('finance-modal-form').dataset.kind);return updateDocumentTotals();}
  if(name==='remove_doc_line'){if($('finance-doc-lines').children.length>1)element.closest('tr').remove();return updateDocumentTotals();}
  if(name==='add_journal_line'){addJournalLine();return updateJournalTotals();}
  if(name==='remove_journal_line'){if($('finance-journal-lines').children.length>2)element.closest('tr').remove();return updateJournalTotals();}
  if(name==='document')return showDocument(id);
  if(name==='pdf_document'){const data=await api('get_document',{id});return FinancePDF.document(data.document,data.payments);}
  if(name==='edit_document'){const {document:d}=await api('get_document',{id});return documentForm(d.kind,d);}
  if(name==='issue_document'){
   const {document:d}=await api('get_document',{id});
   openModal('Issue '+d.kind,formShell(`<div class="finance-hint">Issue this document for ${E(money(d.total,d.currency))}? It will receive a number and post to the ledger. Issued documents are corrected through reversals.</div>`,'Issue document'));
   return bindModal((f,key)=>write('issue_document',{id,version:d.version},key));
  }
  if(name==='delete_draft'){
   openModal('Delete draft',formShell('<div class="finance-hint">Delete this draft? It has no posted ledger entries. The deleted draft is retained in the audit trail.</div>','Delete draft'));return bindModal((f,key)=>write('delete_draft',{id},key));
  }
  if(name==='payment'){const {document:d}=await api('get_document',{id});return paymentForm(d);}
  if(name==='reset_payments')return reasonForm('Set document to unpaid','reset_payments',id,'All active receipts/payments are reversed together, restoring the unpaid balance and the cash/bank balances. Use this for corrections or refunds that actually occurred.');
  if(name==='reverse_payment')return reasonForm('Reverse payment','reverse_payment',id,'This reverses the receipt/payment and restores the amount outstanding. The original payment stays in history.');
  if(name==='void_document')return reasonForm('Void document','void_document',id,'This cancels the invoice or bill and reverses its ledger posting. Recorded payments must be reversed first.');
  if(name==='void_expense')return reasonForm('Void expense','void_expense',id,'This reverses the expense and restores the cash/bank balance. The original expense stays in history.');
  if(name==='reverse_journal')return reasonForm('Reverse ledger entry','reverse_journal',id,'Create an equal and opposite journal entry. The original remains in the ledger.');
  if(name==='statement')return showStatement(id);
  if(name==='export_list')return exportList();
  if(name==='export_report'){const r=reportData(state.report,state.reportKind);return saveDownload(`haulxify-${state.reportKind}-${state.boot.today}.csv`,C.csv(r.headers,r.rows));}
  if(name==='pdf_report')return FinancePDF.report(reportData(state.report,state.reportKind),state.boot.settings);
  if(name==='save_access'){
   const level=$('access-'+id).value;await write('set_access',{id,level});showToast('Accounts access updated.','success');return loadSection();
  }
 }
 document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]');if(!el||el.disabled)return;
  const name=el.dataset.action;
  if(state.dialogBusy)return;
  if(['new_contact','edit_contact','new_account','edit_account','new_invoice','new_bill','new_expense','correct_expense','new_transfer','new_journal','edit_document','issue_document','delete_draft','payment','reset_payments','reverse_payment','void_document','void_expense','reverse_journal'].includes(name)&&!canEdit())return;
  const disabledDuring=['save_access','pdf_document','export_list','pdf_report','document','statement'].includes(name);
  if(disabledDuring)el.disabled=true;
  try{await action(name,el.dataset.id,el);}catch(e){showToast(e.message,'error');}finally{if(disabledDuring)el.disabled=false;}
 });
 $('finance-dialog-close').addEventListener('click',closeModal);
 $('finance-dialog').addEventListener('cancel',event=>{if(state.dialogBusy)event.preventDefault();});
 $('finance-tabs').addEventListener('click',event=>{const tab=event.target.closest('[data-tab]');if(tab)go(tab.dataset.tab);});
 $('finance-filters').addEventListener('submit',event=>{event.preventDefault();state.filters[state.tab]={...filter(),...object(new FormData(event.target))};state.page=0;loadSection();});
 $('finance-content').addEventListener('change',event=>{if(event.target.id==='finance-report-kind'){state.reportKind=event.target.value;$('finance-content').innerHTML=renderReports(state.report);}});
 $('finance-refresh').addEventListener('click',()=>refresh().catch(e=>showToast(e.message,'error')));
 async function start(){
  try{
   await loadNav();const profile=await checkAuth();if(!profile)return;await initTheme(profile.id);
   const access=await api('access');if(access.level==='none'){await refreshAccess();return;}
   state.boot=await api('bootstrap');$('finance-business').textContent=state.boot.settings.business_name;updateAccessLabel();
   $('finance-app').classList.remove('hidden');go(location.hash.slice(1)||'overview');setInterval(refreshAccess,30000);
  }catch(error){$('finance-error').classList.remove('hidden');$('finance-error').innerHTML=`<h2>Accounts setup is required</h2><p>${E(error.message)}</p><p>Run <strong>accounts_setup.sql</strong> on the existing Supabase database, then reload. If setup is already installed, check your connection and accounts permission.</p><a href="leads.html">Return to portal</a>`;}
  finally{$('finance-loading').classList.add('hidden');}
 }
 document.addEventListener('DOMContentLoaded',start);
})();
