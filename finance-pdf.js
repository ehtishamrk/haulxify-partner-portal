/* Local PDF downloads. No customer data is sent to a PDF or sharing service. */
(function(){
 'use strict';
 const C=FinanceCore,margin=16,width=178,bottom=277;
 let fonts;
 function b64(bytes){const parts=[];for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));return btoa(parts.join(''));}
 async function loadFonts(){
  if(!fonts)fonts=Promise.all(['DejaVuSans.ttf','DejaVuSans-Bold.ttf'].map(async name=>{const r=await fetch('vendor/'+name);if(!r.ok)throw Error('PDF font is unavailable. Upload the complete vendor folder.');return b64(new Uint8Array(await r.arrayBuffer()));})).catch(e=>{fonts=null;throw e;});
  return fonts;
 }
 async function create(){
  const [regular,bold]=await loadFonts(),doc=new jspdf.jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
  doc.addFileToVFS('DejaVuSans.ttf',regular);doc.addFont('DejaVuSans.ttf','Portal','normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf',bold);doc.addFont('DejaVuSans-Bold.ttf','Portal','bold');doc.setFont('Portal');
  doc.setProperties({title:'Accounts document',creator:'Haulxify Partner Portal'});return doc;
 }
 function text(doc,value,x,y,size=9,bold=false,options={}){doc.setFont('Portal',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(28,42,61);doc.text(String(value??''),x,y,options);}
 function split(doc,value,w,size=9){doc.setFont('Portal','normal');doc.setFontSize(size);return doc.splitTextToSize(String(value??''),w);}
 function finish(doc,business){const count=doc.internal.getNumberOfPages();for(let i=1;i<=count;i++){doc.setPage(i);doc.setDrawColor(218,224,232);doc.line(margin,283,194,283);text(doc,String(business).slice(0,80),margin,288,7);text(doc,`${i} / ${count}`,194,288,7,false,{align:'right'});}return doc;}
 async function logo(doc,path){
  if(!['images/haulxify.webp','images/aims.webp','images/Union.webp'].includes(path))return false;
  try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=path;});const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);const scale=Math.min(28/img.naturalWidth,14/img.naturalHeight);doc.addImage(canvas.toDataURL('image/png'),'PNG',margin,14,img.naturalWidth*scale,img.naturalHeight*scale);return true;}catch(e){return false;}
 }
 function flow(doc,startY){
  let y=startY;
  const ensure=(height=8)=>{if(y+height>bottom){doc.addPage();y=margin;}return y;};
  const paragraph=(value,{size=9,bold=false,gap=6}={})=>{for(const line of split(doc,value,width,size)){ensure(5);text(doc,line,margin,y,size,bold);y+=size*.45;}y+=gap;};
  function drawTable(headers,rows,widths){
   const headerHeight=10;
   function header(){ensure(headerHeight+8);doc.setFillColor(239,242,246);doc.rect(margin,y,width,headerHeight,'F');let x=margin;headers.forEach((h,i)=>{text(doc,h,x+2,y+6.3,7,true);x+=widths[i];});y+=headerHeight;}
   header();
   for(const row of rows){
    let wrapped=row.map((cell,i)=>split(doc,cell,widths[i]-4,8));
    const maxLines=Math.max(1,...wrapped.map(x=>x.length));let consumed=0;
    // A single exceptionally long row can itself span multiple pages.
    while(consumed<maxLines){
     if(y+9>bottom){doc.addPage();y=margin;header();}
     const capacity=Math.max(1,Math.floor((bottom-y-4)/3.8)),take=Math.min(capacity,maxLines-consumed),height=Math.max(9,take*3.8+4);
     let x=margin;
     wrapped.forEach((lines,i)=>{const chunk=lines.slice(consumed,consumed+take);chunk.forEach((line,j)=>text(doc,line,x+2,y+5+j*3.8,8));x+=widths[i];});
     doc.setDrawColor(224,229,236);doc.line(margin,y+height,194,y+height);y+=height;consumed+=take;
     if(consumed<maxLines){doc.addPage();y=margin;header();}
    }
   }
   y+=8;
  }
  return {get y(){return y;},set y(value){y=value;},ensure,paragraph,table:drawTable};
 }
 async function buildDocument(d,payments=[]){
  const doc=await create(),s=d.issuer_snapshot||{},c=d.contact_snapshot||{},hasLogo=await logo(doc,s.logo_path);
  const label=d.kind==='invoice'?'INVOICE':'SUPPLIER BILL';
  const brand=split(doc,s.business_name||'Business',hasLogo?142:width,12);
  text(doc,brand[0],hasLogo?48:margin,22,12,true);
  if(brand.length>1)text(doc,brand[1]+(brand.length>2?'...':''),hasLogo?48:margin,28,12,true);
  text(doc,label,194,41,18,true,{align:'right'});text(doc,d.number||'DRAFT',194,50,10,true,{align:'right'});
  doc.setDrawColor(232,119,34);doc.setLineWidth(.7);doc.line(margin,57,194,57);doc.setLineWidth(.2);
  const issuer=[s.business_name,s.address,s.email,s.phone,s.tax_id?'Tax / registration: '+s.tax_id:''].filter(Boolean).join('\n');
  const customer=[c.name,c.address,c.email,c.phone,c.tax_id?'Tax / registration: '+c.tax_id:''].filter(Boolean).join('\n');
  text(doc,'FROM',margin,66,8,true);text(doc,d.kind==='invoice'?'BILL TO':'SUPPLIER',110,66,8,true);
  const left=split(doc,issuer,82,9),right=split(doc,customer,84,9);
  let y=73;
  const f=flow(doc,y);
  for(let i=0;i<Math.max(left.length,right.length);i++){f.ensure(5);if(left[i])text(doc,left[i],margin,f.y,9);if(right[i])text(doc,right[i],110,f.y,9);f.y+=4.3;}
  f.y+=9;f.paragraph(`Issued: ${C.date(d.issue_date)}     Due: ${C.date(d.due_date)}     Currency: ${d.currency}`,{size:8});
  if(d.reference)f.paragraph('Reference: '+d.reference,{size:8});
  if(d.is_opening)f.paragraph('Opening balance from previous books',{size:8});
  if(d.state==='draft')f.paragraph('DRAFT - not issued and not posted to the ledger',{size:10,bold:true});
  if(d.state==='void')f.paragraph('VOIDED - '+(d.void_reason||'Cancelled'),{size:10,bold:true});
  const rows=d.items.map(x=>[x.description,String(x.quantity),C.money(x.rate,d.currency),`${x.discount_pct}%`,`${x.tax_pct}%`,C.money(x.total,d.currency)]);
  f.table(['Description','Qty','Unit price','Disc.','Tax','Amount'],rows,[65,13,28,15,15,42]);
  const totals=[['Subtotal',d.subtotal],['Discount',-Number(d.discount_total)],['Tax',d.tax_total],['TOTAL',d.total],['Paid',d.amount_paid||0]];
  for(const [name,value] of totals){f.ensure(9);const bold=name==='TOTAL';text(doc,name,124,f.y,9,bold);text(doc,C.money(value,d.currency),194,f.y,9,bold,{align:'right'});f.y+=7;}
  f.ensure(9);text(doc,'Outstanding',124,f.y,10,true);text(doc,d.state==='void'?'Voided':C.money(d.outstanding??d.total,d.currency),194,f.y,10,true,{align:'right'});f.y+=13;
  if(d.notes){f.paragraph('Notes / terms',{bold:true});f.paragraph(d.notes,{size:8});}
  if(s.payment_details&&d.state!=='void'){f.paragraph('Payment instructions',{bold:true});f.paragraph(s.payment_details,{size:8});}
  const active=payments.filter(p=>!p.reversed_at);
  if(active.length){f.paragraph('Recorded payments',{bold:true});f.table(['Date','Account / reference','Amount'],active.map(p=>[C.date(p.payment_date),(p.cash_name||'')+(p.reference?' - '+p.reference:''),C.money(p.amount,d.currency)]),[30,98,50]);}
  return finish(doc,(d.number||'Draft')+' | '+(s.business_name||''));
 }
 async function buildReport(data,s){
  const doc=await create();const f=flow(doc,23);f.paragraph(s.business_name||'Business',{size:13,bold:true});
  f.paragraph(data.title,{size:15,bold:true});f.paragraph(data.sub||'',{size:8});
  const n=data.headers.length;
  let widths=n===2?[120,58]:n===4?[20,90,34,34]:n===7?[25,19,39,26,26,24,19]:Array(n).fill(width/n);
  f.table(data.headers,data.rows,widths);
  return finish(doc,s.business_name||'');
 }
 function filename(s){return String(s).replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,100)||'document';}
 window.FinancePDF={buildDocument,buildReport,
  async document(d,payments){const doc=await buildDocument(d,payments);doc.save(filename(d.number||'Draft-'+d.kind)+'.pdf');},
  async report(data,settings){const doc=await buildReport(data,settings);doc.save(filename(data.title)+'.pdf');}
 };
})();
