import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {recordSourceSkip} from '../lib/profile-sync-exclusions.ts';
const capture='2026-01-01T01:02:03.004Z';
for(const reason of ['unmapped-city','explicit-empty-photos']){
 test('persists bounded '+reason+' receipt, not a source removal',async()=>{
  const rows=[];
  const db={from(table){assert.equal(table,'profile_sync_runs');return {async insert(row){rows.push(row);return {error:null}}}}};
  await recordSourceSkip(db,'123',capture,reason);
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0].summary,{version:1,sourceKey:'123',capture,reason});
  assert.equal(rows[0].mode,'source-exclusion');
  assert.equal(rows[0].status,'success');
 });
}
test('receipt persistence failure is not counted as completed processing',async()=>{
 await assert.rejects(recordSourceSkip({from(){return {async insert(){return {error:{message:'failed'}}}}}},'123',capture,'unmapped-city'),/persistence failed/);
});
test('invalid receipt shape never writes',async()=>{
 const db={from(){throw Error('must not write')}};
 for(const [key,date,reason] of [['','x','unmapped-city'],['123',capture,'age-unknown'],['name',capture,'unmapped-city']]){
  await assert.rejects(recordSourceSkip(db,key,date,reason),/Invalid/);
 }
});
test('preview cannot persist receipts and no-photo cannot call destructive RPC',()=>{
 const route=readFileSync('app/api/profile-sync/route.ts','utf8');
 assert(route.indexOf('if (mode === "preview") return')<route.indexOf('await recordSourceSkip'));
 assert(!route.includes('supabase.rpc("sexy00_remove_photoless_profile"'));
 assert(route.includes('recordSourceSkip(supabase,profile.sourceKey,capturedAt,"unmapped-city")'));
});
test('adult publishing decisions remain independent and unchanged',()=>{
 const route=readFileSync('app/api/profile-sync/route.ts','utf8');
 assert(route.includes('syncAdultReview(profile.details.age'));
 assert(route.includes('adult_publish_hold'));
 assert(route.includes('if(profile.photoState === "invalid")throw'));
});
