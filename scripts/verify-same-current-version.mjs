import {pathToFileURL} from 'node:url';
export const EXPECTED_DEPLOYMENT='79c89b29-e367-4a01-bcdf-bb20621513d3';
export const EXPECTED_MAIN='3813bb3e6870d153e9d0e3f85c2ce93e8144d02f';
export const EXPECTED_VERSION='497a639b-c263-49b4-a240-5313284bb58f';
export async function verifySameVersion({account,token,githubToken,approval,repository,attempt,fetchImpl=fetch}){
 if(approval!=='sexy00-same-current-version-once'||repository!=='nning00/sexy00-profile-sync'||String(attempt)!=='1')throw Error('Explicit single-attempt authorization missing');
 if(!/^[a-f0-9]{32}$/.test(account||'')||!token)throw Error('Existing sexy00 credentials missing');
 const mainResponse=await fetchImpl('https://api.github.com/repos/nning00/sexy00-profile-sync/git/ref/heads/main',{
  headers:githubToken?{Authorization:'Bearer '+githubToken,Accept:'application/vnd.github+json'}:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});
 const main=await mainResponse.json();
 if(!mainResponse.ok||main.object?.sha!==EXPECTED_MAIN)throw Error('Main changed; stop before production operation');
 const endpoint='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/sexy00-site/deployments';
 async function read(){
  const r=await fetchImpl(endpoint,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  const d=await r.json();
  if(!r.ok||d.success!==true)throw Error('Deployment read failed');
  const rows=d.result?.deployments??d.result;
  const v=Array.isArray(rows)?rows[0]:null;
  if(v?.versions?.length!==1||v.versions[0].version_id!==EXPECTED_VERSION||v.versions[0].percentage!==100)throw Error('Baseline changed; no automatic operation allowed');
  return v;
 }
 async function health(){
  // Public health receives NO Cloudflare token or user credentials.
  const r=await fetchImpl('https://sexy00.cc/api/health',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
  const d=await r.json();
  if(!r.ok||d.ok!==true||d.database!=='connected')throw Error('Health check failed');
 }
 const before=await read();
 if(before.id!==EXPECTED_DEPLOYMENT)throw Error('Approved deployment baseline changed; stop');
 await health();
 // Recheck immediately before mutation, never force a newer deployment back.
 const immediate=await read();
 if(immediate.id!==before.id)throw Error('Deployment changed during health check');
 let submitted=false;
 try{
  // Exactly one POST. No retry if outcome is ambiguous.
  const r=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({strategy:'percentage',versions:[{version_id:EXPECTED_VERSION,percentage:100}],annotations:{'workers/message':'Approved sexy00 same-current-version rollback capability verification'}}),
   signal:AbortSignal.timeout(20000)});
  const d=await r.json();
  if(!r.ok||d.success!==true)throw Error('Same-version submission rejected');
  submitted=true;
 }catch(error){
  throw Error('Same-version submission failed or outcome unknown; DO NOT RETRY automatically',{cause:error});
 }
 const after=await read();
 if(after.id===before.id)throw Error('No new deployment record; operation not verified');
 await health();
 return {worker:'sexy00-site',version:EXPECTED_VERSION,beforeDeployment:before.id,afterDeployment:after.id,submitted,health:'passed',sameVersionVerified:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const out=await verifySameVersion({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN,githubToken:process.env.GITHUB_TOKEN,approval:process.env.APPROVED_OPERATION,repository:process.env.GITHUB_REPOSITORY,attempt:process.env.GITHUB_RUN_ATTEMPT});
 console.log(JSON.stringify(out));
}
