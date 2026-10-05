import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),C=require('../finance-core.js');
test('exact previews match server rounding before and after tax',()=>{
 const result=C.totals([{quantity:'3',rate:'99.99',discount_pct:'10',tax_pct:'17'}]);
 assert.deepEqual(result,{subtotal:'299.97',discount_total:'30.00',tax_total:'45.89',total:'315.86'});
 assert.equal(C.line({quantity:'0.125',rate:'0.04',tax_pct:'0'}).total,'0.01');
 assert.equal(C.line({quantity:'1',rate:'100',discount_pct:'100',tax_pct:'17'}).total,'0.00');
});
test('decimal parsing rejects malformed and excessive precision amounts',()=>{
 for(const x of ['NaN','Infinity','1e6','0.001','ten'])assert.throws(()=>C.scaled(x));
 assert.equal(C.decimal(C.scaled('123.45')),'123.45');assert.equal(C.sum(['0.1','0.2']),'0.30');
});
test('text is escaped and CSV formula injection is neutralized',()=>{
 assert.equal(C.escape('<script>"&\''),'&lt;script&gt;&quot;&amp;&#39;');
 const csv=C.csv(['Name','Amount'],[['=IMPORTXML("https://bad")',-10],['\t=1+1',20]]);
 assert.ok(csv.includes("\"'=IMPORTXML"));assert.ok(csv.includes('"-10"'));assert.ok(csv.includes("\"'\t=1+1"));
});
