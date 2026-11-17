import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifySameVersion,EXPECTED_VERSION,EXPECTED_DEPLOYMENT,EXPECTED_MAIN} from '../scripts/verify-same-current-version.mjs';
function config(fetchImpl){return {account:'a'.repeat(32),token:'test-not-real',githubToken:'fake-github-token',approval:'sexy00-same-current-version-once',repository:'nning00/sexy00-profile-sync',attempt:1,fetchImpl};}
function harness({drift=false,healthFail=false,postFail=false,syncActive=false,queued=false,replacedAfterPost=false,mainDrift=false,syncResumed=false}={}){
 const calls=[];let reads=0;let guards=0;let posted=false;
 const postedId='11111111-1111-4111-8111-111111111111';
 return {calls,async fetchImpl(url,opts){
  calls.push({url,opts});
  if(url.startsWith('https://api.github.com/')){
   assert.equal(opts.headers.Authorization,'Bearer fake-github-token');
   if(url.endsWith('/git/ref/heads/main')){
    guards++;
    return Response.json({object:{sha:mainDrift&&guards>1?'changed':EXPECTED_MAIN}});
   }
   if(url.endsWith('/actions/workflows/profile-sync.yml'))return Response.json({state:syncActive||(syncResumed&&guards>1)?'active':'disabled_manually'});
   if(url.endsWith('/actions/workflows/profile-sync.yml/runs?per_page=100'))return Response.json({workflow_runs:[{status:queued?'queued':'completed'}]});
  }
  if(url==='https://sexy00.cc/api/health'){assert(!opts.headers);return Response.json({ok:!healthFail,database:healthFail?'unavailable':'connected'});}
  assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+'a'.repeat(32)+'/workers/scripts/sexy00-site/deployments');
  assert.equal(opts.headers.Authorization,'Bearer test-not-real');
  if(opts.method==='POST'){if(postFail)throw Error('timeout');posted=true;return Response.json({success:true,result:{id:postedId}});}
  reads++;return Response.json({success:true,result:{deployments:[{id:posted?(replacedAfterPost?'22222222-2222-4222-8222-222222222222':postedId):(drift&&reads>1?'drift':EXPECTED_DEPLOYMENT),versions:[{version_id:EXPECTED_VERSION,percentage:100}]}]}});
 }};
}
test('same-version verification never uploads code and posts exactly once',async()=>{const h=harness();const r=await verifySameVersion(config(h.fetchImpl));assert(r.sameVersionVerified);assert.equal(h.calls.filter(x=>x.opts.method==='POST').length,1);const b=JSON.parse(h.calls.find(x=>x.opts.method==='POST').opts.body);assert.deepEqual(b.versions,[{version_id:EXPECTED_VERSION,percentage:100}]);});
test('baseline drift stops before any POST',async()=>{const h=harness({drift:true});await assert.rejects(verifySameVersion(config(h.fetchImpl)),/changed/);assert(!h.calls.some(x=>x.opts.method==='POST'));});
test('unhealthy baseline stops before any POST',async()=>{const h=harness({healthFail:true});await assert.rejects(verifySameVersion(config(h.fetchImpl)),/Health/);assert(!h.calls.some(x=>x.opts.method==='POST'));});
test('ambiguous POST is never retried',async()=>{const h=harness({postFail:true});await assert.rejects(verifySameVersion(config(h.fetchImpl)),/DO NOT RETRY/);assert.equal(h.calls.filter(x=>x.opts.method==='POST').length,1);});
test('reruns and missing exact authorization fail before network',async()=>{for(const patch of [{attempt:2},{approval:''},{repository:'nning00/other'}])await assert.rejects(verifySameVersion({...config(()=>{throw Error('unexpected network')}),...patch}),/authorization/);});
test('active sync, outstanding run, or protected-main/sync drift stop before POST',async()=>{for(const flags of [{syncActive:true},{queued:true},{mainDrift:true},{syncResumed:true}]){const h=harness(flags);await assert.rejects(verifySameVersion(config(h.fetchImpl)),/changed|paused|outstanding/);assert(!h.calls.some(x=>x.opts.method==='POST'));}});
test('a different same-version deployment after the POST is not verified',async()=>{const h=harness({replacedAfterPost:true});await assert.rejects(verifySameVersion(config(h.fetchImpl)),/does not match/);assert.equal(h.calls.filter(x=>x.opts.method==='POST').length,1);});
