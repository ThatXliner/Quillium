import https from 'node:https';
import fs from 'node:fs';
const urls=['https://dv-g3b-emudhra.we-have-a-problem.com/','https://dv-g3b-aaa-emudhra.we-have-a-problem.com/','https://example.com/'];
const certificateFailure=e=>/CERT|ISSUER|VERIFY|SELF_SIGNED|UNABLE_TO_GET/i.test(`${e?.code} ${e?.message} ${e?.cause?.code} ${e?.cause?.message}`);
const attempts=[];
const results=await Promise.all(['fetch','node:https'].flatMap(api=>urls.map(async url=>{
 const expected=url==='https://example.com/'?'success':'certificate_rejection';
 let row;
 for(let attempt=1;attempt<=3;attempt++){
  row={api,url,expected,attempt,runtime:process.versions.bun||process.version,revision:globalThis.Bun?.revision};
  try {
   if(api==='fetch'){const res=await fetch(url,{signal:AbortSignal.timeout(15000)});row.status=res.status;await res.arrayBuffer();}
   else await new Promise((resolve,reject)=>{const timer=setTimeout(()=>req.destroy(new Error('timeout')),15000);const req=https.get(url,{agent:false,family:4},res=>{row.status=res.statusCode;res.resume();res.on('end',()=>{clearTimeout(timer);resolve();});});req.on('error',e=>{clearTimeout(timer);reject(e);});});
   row.actual='success';
  }catch(e){row.actual=certificateFailure(e)?'certificate_rejection':'inconclusive';row.error={code:e.code,message:e.message,causeCode:e.cause?.code,causeMessage:e.cause?.message};}
  row.pass=row.actual===expected;attempts.push(row);console.log(JSON.stringify(row));
  // Never retry a compromised certificate acceptance into a passing result.
  if(row.actual!=='inconclusive')break;
 }
 return row;
})));
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify({pass:results.every(x=>x.pass),results,attempts},null,2)+'\n');
process.exit(results.every(x=>x.pass)?0:1);
