/* Exact decimal previews, display and safe exports. Database remains authoritative. */
(function (root, factory) {
 const core=factory();
 if(typeof module==='object' && module.exports) module.exports=core;
 else root.FinanceCore=core;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function scaled(value,places=2){
  const text=String(value??'0').trim();
  if(!/^-?\d+(\.\d+)?$/.test(text))throw Error('Enter a valid decimal amount.');
  const negative=text.startsWith('-'),[whole,fraction='']=text.replace(/^-/,'').split('.');
  if(fraction.length>places && /[1-9]/.test(fraction.slice(places)))throw Error(`Use at most ${places} decimal places.`);
  return (negative?-1n:1n)*(BigInt(whole)*10n**BigInt(places)+BigInt((fraction+'0'.repeat(places)).slice(0,places)||'0'));
 }
 function rounded(num,den){const sign=num<0n?-1n:1n;num=num<0n?-num:num;return sign*((num+den/2n)/den);}
 function decimal(units,places=2){const sign=units<0n?'-':'';units=units<0n?-units:units;const pow=10n**BigInt(places);return sign+(units/pow)+'.'+String(units%pow).padStart(places,'0');}
 function line(item){
  const qty=scaled(item.quantity,3),rate=scaled(item.rate,2),disc=scaled(item.discount_pct||0,3),tax=scaled(item.tax_pct||0,3);
  if(qty<=0n || rate<0n || disc<0n || disc>100000n || tax<0n || tax>100000n)throw Error('Check quantity, price and percentages.');
  const gross=rounded(qty*rate,1000n),discount=rounded(gross*disc,100000n),net=gross-discount,vat=rounded(net*tax,100000n);
  return {gross:decimal(gross),discount:decimal(discount),net:decimal(net),tax:decimal(vat),total:decimal(net+vat)};
 }
 function totals(items){
  const out={subtotal:0n,discount_total:0n,tax_total:0n,total:0n};
  for(const item of items){const x=line(item);out.subtotal+=scaled(x.gross);out.discount_total+=scaled(x.discount);out.tax_total+=scaled(x.tax);out.total+=scaled(x.total);}
  return Object.fromEntries(Object.entries(out).map(([k,v])=>[k,decimal(v)]));
 }
 function money(value,currency='PKR'){
  return new Intl.NumberFormat('en-US',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0));
 }
 function sum(values){return decimal(values.reduce((total,value)=>total+scaled(value),0n));}
 function escape(text){return String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 function csvCell(value){
  let text=String(value??'');
  if(typeof value==='string' && /^[\s]*[=+\-@\t\r]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
 }
 function csv(headers,rows){return '\uFEFF'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');}
 function date(text){if(!text)return '—';const d=new Date(String(text).slice(0,10)+'T12:00:00Z');return Number.isNaN(d.valueOf())?'—':new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:'UTC'}).format(d);}
 function uuid(){if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();throw Error('Open this portal over HTTPS or localhost to save financial records.');}
 return {scaled,rounded,decimal,line,totals,money,sum,escape,csv,date,uuid};
});
