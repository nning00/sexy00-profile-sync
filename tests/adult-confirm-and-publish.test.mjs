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
const { confirmAndPublishAdultBatch,confirmAndPublishAdultDraft,publishAdultDraft }=await import("../lib/adult-receipts.ts");
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

test("prepared photos are read once and only one RPC commits eligible drafts together",async()=>{
  const more="00000000-0000-4000-8000-000000000003";
  const stale="00000000-0000-4000-8000-000000000004";
  const missing="00000000-0000-4000-8000-000000000005";
  const proofRows=[{id,slug:"old-url"},{id:more,slug:"another-old-url"},{id:stale,slug:"stale"},{id:missing,slug:"missing"}].map(x=>{
    const storage_path=`gpt-copy/profiles/qa/${x.slug}.jpg`;
    return {...fixture().row,...x,card_image_path:storage_path,profile_source_images:[{...sourcePhoto,storage_path}]};
  });
  const versionFor=(storage_path)=>({storage_path,object_id:id,revision:"mock-version",updated_at:version});
  const reads=[];const writes=[];
  const db={
    from(table){
      assert.equal(table,"profiles");
      return {select(){return this;},eq(){return this;},async in(_,ids){
        assert.deepEqual(ids,[id,more,stale,missing]);return {data:proofRows};
      }};
    },
    storage:{from(bucket){
      assert.equal(bucket,"site-media");
      return {async download(path,opts,fetchOpts){
        reads.push(path);assert.equal(opts.cacheNonce,"mock-version");assert.equal(fetchOpts.cache,"no-store");
        return {data:new Blob([`fake bytes: ${path}`])};
      }};
    }},
    async rpc(op,args) {
      if(op==="sexy00_adult_review_media_versions"){
        assert.equal(args.p_paths.length,3);
        return {data:args.p_paths.filter(path=>!path.includes("missing")).map(versionFor)};
      }
      assert.equal(op,"sexy00_confirm_publish_adult_batch");
      writes.push(args);
      return {data:[{id,status:"published",slug:"old-url"},{id:more,status:"not-eligible"}]};
    },
  };
  const result=await confirmAndPublishAdultBatch(db,[{id,version},{id:more,version},{id:stale,version:nextVersion},{id:missing,version}],reviewer);
  assert.equal(writes.length,1);
  assert.deepEqual(writes[0].p_records.map(r=>r.id),[id,more]);
  assert.equal(writes[0].p_reviewer,reviewer);
  assert.equal(reads.length,2);
  assert.equal(writes[0].p_records[0].photos[0].revision,"mock-version");
  assert.match(writes[0].p_records[0].photos[0].sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(result.published,[{id,slug:"old-url"}]);
  assert.deepEqual(result.failed.map(r=>r.id).sort(),[more,stale,missing].sort());
});
