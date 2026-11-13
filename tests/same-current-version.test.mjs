import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifySameVersion,EXPECTED_VERSION,EXPECTED_DEPLOYMENT,EXPECTED_MAIN} from '../scripts/verify-same-current-version.mjs';
function config(fetchImpl){return {account:'a'.repeat(32),token:'test-not-real',approval:'sexy00-same-current-version-once',repository:'nning00/sexy00-profile-sync',attempt:1,fetchImpl};}
function harness({drift=false,healthFail=false,postFail=false}={}){
 const calls=[];let reads=0;let posted=false;
 return {calls,async fetchImpl(url,opts){
  calls.push({url,opts});
  if(url.startsWith('https://api.github.com/'))return Response.json({object:{sha:EXPECTED_MAIN}});
  if(url==='https://sexy00.cc/api/health'){assert(!opts.headers);return Response.json({ok:!healthFail,database:healthFail?'unavailable':'connected'});}
  if(opts.method==='POST'){if(postFail)throw Error('timeout');posted=true;return Response.json({success:true,result:{id:'new'}});}
  reads++;return Response.json({success:true,result:{deployments:[{id:posted?'new':(drift&&reads>1?'drift':EXPECTED_DEPLOYMENT),versions:[{version_id:EXPECTED_VERSION,percentage:100}]}]}});
 }};
}
test('same-version verification never uploads code and posts exactly once',async()=>{const h=harness();const r=await verifySameVersion(config(h.fetchImpl));assert(r.sameVersionVerified);assert.equal(h.calls.filter(x=>x.opts.method==='POST').length,1);const b=JSON.parse(h.calls.find(x=>x.opts.method==='POST').opts.body);assert.deepEqual(b.versions,[{version_id:EXPECTED_VERSION,percentage:100}]);});
test('baseline drift stops before any POST',async()=>{const h=harness({drift:true});await assert.rejects(verifySameVersion(config(h.fetchImpl)),/changed/);assert(!h.calls.some(x=>x.opts.method==='POST'));});
test('unhealthy baseline stops before any POST',async()=>{const h=harness({healthFail:true});await assert.rejects(verifySameVersion(config(h.fetchImpl)),/Health/);assert(!h.calls.some(x=>x.opts.method==='POST'));});
test('ambiguous POST is never retried',async()=>{const h=harness({postFail:true});await assert.rejects(verifySameVersion(config(h.fetchImpl)),/DO NOT RETRY/);assert.equal(h.calls.filter(x=>x.opts.method==='POST').length,1);});
test('reruns and missing exact authorization fail before network',async()=>{for(const patch of [{attempt:2},{approval:''},{repository:'nning00/other'}])await assert.rejects(verifySameVersion({...config(()=>{throw Error('unexpected network')}),...patch}),/authorization/);});
