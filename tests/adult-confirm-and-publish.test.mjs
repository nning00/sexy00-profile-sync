import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Allow the same extensionless relative TS imports the build resolves.
const hooks=registerHooks({
  resolve(specifier,context,next) {
    if (context.parentURL?.includes("/lib/") && /^\.\.?\/[a-z-]+$/.test(specifier)) {
      return next(`${specifier}.ts`,context);
    }
    return next(specifier,context);
  },
});
const { confirmAndPublishAdultDraft,publishAdultDraft }=await import("../lib/adult-receipts.ts");
hooks.deregister();

process.env.NEXT_PUBLIC_SUPABASE_URL="https://kkxsclcqdxoiqucunpur.supabase.co";
process.env.NEXT_PUBLIC_MEDIA_PREFIX="gpt-copy";
const id="00000000-0000-4000-8000-000000000001";
const reviewer="00000000-0000-4000-8000-000000000002";
const version="2026-11-10T12:00:00.123456+00:00";
const nextVersion="2026-11-10T12:01:00.123456+00:00";
const sourcePhoto={source_url:"https://example.invalid/photo",storage_path:"gpt-copy/profiles/qa/photo.jpg",created_at:version};

function fixture({photoChanges=false,stageFails=false,publishFails=false}={}) {
  const row={id,slug:"keep-original-url",status:"draft",adult_publish_hold:false,updated_at:version,
    source_key:"qa",source_url:"https://example.invalid/qa",display_name:"Synthetic",
    introduction:'{"age":""}',source_content_hash:"a".repeat(64),adult_verified_at:null,
    adult_review_status:"pending",source_provider:"edc-public-catalog",
    profile_cities:[],profile_source_images:[sourcePhoto]};
  const calls=[];
  let reads=0;
  const db={
    from(table) {
      assert.equal(table,"profiles");
      const filters=[];
      return {
        select(){return this;},
        eq(key,value){filters.push([key,value]);return this;},
        async single(){return {data:filters.every(([key,value])=>row[key]===value)?{...row}:null};},
      };
    },
    storage:{from(bucket){
      assert.equal(bucket,"site-media");
      return {async download(path){
        assert.equal(path,sourcePhoto.storage_path);
        reads++;
        return {data:new Blob([photoChanges && reads>1?"different content":"same content"])};
      }};
    }},
    async rpc(operation,params) {
      calls.push([operation,params]);
      if(operation==="sexy00_stage_adult_receipt"){
        if(stageFails)return {error:{message:"fixture rejects stale evidence"}};
        Object.assign(row,{adult_review_status:"verified",adult_publish_hold:true,adult_verified_by:reviewer,updated_at:nextVersion});
        return {data:{bound:true}};
      }
      assert.equal(operation,"sexy00_publish_adult_draft");
      if(publishFails)return {error:{message:"fixture rejects publication"}};
      Object.assign(row,{status:"published",adult_publish_hold:false});
      return {data:{slug:row.slug}};
    },
  };
  return {db,row,calls,get reads(){return reads;}};
}

test("a reviewed pending row is confirmed and published with the new version and original URL",async()=>{
  const f=fixture();
  assert.deepEqual(await confirmAndPublishAdultDraft(f.db,id,version,reviewer),{id,slug:f.row.slug});
  assert.deepEqual(f.calls.map(([name,p])=>[name,p.p_profile_id,p.p_expected_updated_at]),[
    ["sexy00_stage_adult_receipt",id,version],["sexy00_publish_adult_draft",id,nextVersion],
  ]);
  assert.equal(f.reads,2);
  assert.equal(f.row.status,"published");
});

test("a stale version or a pending row submitted for legacy publication cannot write",async()=>{
  const f=fixture();
  await assert.rejects(confirmAndPublishAdultDraft(f.db,id,nextVersion,reviewer),/資料已更新/);
  await assert.rejects(publishAdultDraft(f.db,id,version,reviewer),/尚未完成成年確認/);
  assert.deepEqual(f.calls,[]);
  assert.equal(f.row.status,"draft");
});

test("a stage rejection, changed photo bytes, or publish rejection does not make the row public",async()=>{
  for(const options of [{stageFails:true},{photoChanges:true},{publishFails:true}]){
    const f=fixture(options);
    await assert.rejects(confirmAndPublishAdultDraft(f.db,id,version,reviewer));
    assert.equal(f.row.status,"draft");
    assert.equal(f.calls.length,options.publishFails?2:1);
    assert.equal(f.row.adult_publish_hold,!options.stageFails);
  }
});
