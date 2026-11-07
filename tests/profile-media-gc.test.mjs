import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {safeProfileMediaPath,referencedPaths,collectUnusedProfileMedia} from '../lib/profile-media-gc.ts';
const orphan='gpt-copy/profiles/old/orphan.webp', shared='gpt-copy/profiles/old/shared.webp';
process.env.NEXT_PUBLIC_SUPABASE_URL='https://kkxsclcqdxoiqucunpur.supabase.co';
process.env.NEXT_PUBLIC_MEDIA_PREFIX='gpt-copy';
function database(options={}){
 const calls=[],deleted=[];
 const client=createClient('https://test.invalid','test-key',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
  const u=new URL(String(input)),method=init?.method??'GET';calls.push({u,method,body:init?.body});
  if(u.pathname.endsWith('/rpc/sexy00_queue_orphan_media'))return Response.json(0);
  if(u.pathname.endsWith('/rpc/sexy00_gc_allowed'))return Response.json((options.sqlProtected?[]:[{path:orphan},{path:shared}]));
  if(u.pathname.includes('/storage/v1/object/site-media')){
   if(options.storageError)return Response.json({message:'Storage unavailable'},{status:400});
   const body=JSON.parse(init.body);deleted.push(...body.prefixes);return Response.json(body.prefixes.map(name=>({name})));
  }
  if(u.pathname.endsWith('/profile_media_gc')){
   if(method==='DELETE'){assert.ok(String(u).length<4000);return new Response(null,{status:204});}
   return Response.json([{path:orphan},{path:shared}],{headers:options.missingCount?{}:{'content-range':'0-1/2'}});
  }
  if(options.readError)return Response.json({message:'Reference read failed'},{status:400});
  const table=u.pathname.split('/').at(-1);
  if(table==='site_settings'&&!u.searchParams.has('key'))return Response.json([{key:'hero',value:{image:'/api/media?path='+encodeURIComponent(shared)}}]);
  return Response.json([]);
 }}});
 return {client,calls,deleted};
}
test('path validation never accepts foreign prefixes, absolute URLs or traversal',()=>{
 assert.equal(safeProfileMediaPath(orphan),true);
 for(const path of ['profiles/a.webp','gpt-copy/articles/a.webp','gpt-copy/profiles/../logo.webp','https://other.invalid/a.webp','/gpt-copy/profiles/a.webp','gpt-copy/profiles/%2e%2e/a.webp'])assert.equal(safeProfileMediaPath(path),false);
});
test('nested and double-encoded references remain protected',()=>{
 const found=referencedPaths({hero:[{src:'/api/media?path='+encodeURIComponent(encodeURIComponent(shared))}]},[shared,orphan]);
 assert.ok(found.has(shared));assert.equal(found.has(orphan),false);
});
test('preview reports possible cleanup but performs no mutations',async()=>{
 const db=database();const r=await collectUnusedProfileMedia(db.client,false);
 assert.equal(r.wouldRemove,1);assert.equal(r.removed,0);assert.deepEqual(db.deleted,[]);
 assert.ok(db.calls.every(x=>x.method==='GET'||x.u.pathname.endsWith('/rpc/sexy00_gc_allowed')));
});
test('commit removes only unreferenced owned files and acknowledges bounded queue batches',async()=>{
 const db=database();const r=await collectUnusedProfileMedia(db.client,true);
 assert.deepEqual(db.deleted,[orphan]);assert.equal(r.removed,1);assert.equal(r.protected,1);
});
test('final database reference check is authoritative even if an earlier scan missed a reference',async()=>{
 const db=database({sqlProtected:true});const r=await collectUnusedProfileMedia(db.client,true);
 assert.equal(r.removed,0);assert.deepEqual(db.deleted,[]);
});
for(const option of ['readError','storageError'])test(option+' preserves the queue for retry',async()=>{
 const db=database({[option]:true});await assert.rejects(collectUnusedProfileMedia(db.client,true));
 assert.ok(db.calls.every(x=>!x.u.pathname.endsWith('/profile_media_gc')||x.method!=='DELETE'));
});
test('a wrong project refuses cleanup before reading or writing anything',async()=>{
 const db=database();const saved=process.env.NEXT_PUBLIC_SUPABASE_URL;
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://unrelated.invalid';
 try{await assert.rejects(collectUnusedProfileMedia(db.client,true),/target mismatch/);assert.equal(db.calls.length,0);}finally{process.env.NEXT_PUBLIC_SUPABASE_URL=saved;}
});
test('missing exact queue count refuses deletion rather than reporting a false completion',async()=>{
 const db=database({missingCount:true});await assert.rejects(collectUnusedProfileMedia(db.client,true),/count-unavailable/);
 assert.deepEqual(db.deleted,[]);assert.ok(db.calls.every(x=>!x.u.pathname.endsWith('/profile_media_gc')||x.method!=='DELETE'));
});
