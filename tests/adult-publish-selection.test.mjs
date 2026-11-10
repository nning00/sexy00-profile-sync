import test from "node:test";
import assert from "node:assert/strict";
import { validReviewSelection,selectedReviewRows,checkPublishedProfileUrl } from "../lib/adult-publish-selection.ts";
import { syncAdultReview } from "../lib/adult-receipt-policy.ts";
import { hideProfileAgeText } from "../lib/profile-details.ts";

const row=(n)=>({id:`00000000-0000-4000-8000-00000000000${n}`,version:"2026-11-10T12:00:00.123456+00:00"});
test("select-all scope is the eligible list; untouched and stale IDs are not submitted",()=>{
  const list=[row(1),row(2)];
  assert.deepEqual(selectedReviewRows(list,new Set([row(1).id,row(3).id])),[row(1)]);
  assert.deepEqual(selectedReviewRows(list,new Set(list.map(r=>r.id))),list);
});
test("server batch accepts only bounded, unique UUIDs with versions",()=>{
  assert.equal(validReviewSelection([row(1),row(2)]),true);
  for(const input of [[],[row(1),row(1)],[row(1),row(2),row(3),row(4)],[{...row(1),version:""}],[{...row(1),id:"all"}]])assert.equal(validReviewSelection(input),false);
});
test("a hold prevents background publication even with source age; invalidated and minor evidence stays blocked",()=>{
  assert.deepEqual(syncAdultReview("",true,false,true),{reviewStatus:"verified",targetStatus:"draft"});
  assert.deepEqual(syncAdultReview("21",false,false,true),{reviewStatus:"pending",targetStatus:"draft"});
  assert.deepEqual(syncAdultReview("17",true,false,true),{reviewStatus:"rejected",targetStatus:"archived"});
  assert.deepEqual(syncAdultReview("",false,false),{reviewStatus:"pending",targetStatus:"draft"});
  assert.deepEqual(syncAdultReview("21",false,false),{reviewStatus:"verified",targetStatus:"published"});
});
test("public description omits display age without affecting other measurements",()=>{
  assert.equal(hideProfileAgeText("範例：22歲、165公分。"),"範例：165公分。");
  assert.equal(hideProfileAgeText("範例｜22歲"),"範例");
});
test("post-publication URL check is anonymous and retries a transient 404 once",async()=>{
  const statuses=[404,200];
  const checks=[];
  const result=await checkPublishedProfileUrl("/profiles/old-slug",async(path,opts)=>{
    checks.push([path,opts.credentials,opts.cache]);return new Response(null,{status:statuses.shift()});
  },async()=>{});
  assert.equal(result.status,200);
  assert.deepEqual(checks,[["/profiles/old-slug","omit","no-store"],["/profiles/old-slug","omit","no-store"]]);
});
test("persistent 404 is reported without treating network errors or unsafe paths as success",async()=>{
  assert.equal((await checkPublishedProfileUrl("/profiles/old-slug",async()=>new Response(null,{status:404}),async()=>{})).status,404);
  assert.equal((await checkPublishedProfileUrl("//foreign.example/path",async()=>assert.fail("unexpected request"),async()=>{})).status,null);
});
