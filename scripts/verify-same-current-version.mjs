import {pathToFileURL} from 'node:url';
export const EXPECTED_DEPLOYMENT='e3cfda98-16a8-4bbb-addf-e481ce9cfdf5';
export const EXPECTED_MAIN='2c2ce51a56e8b46f92c479d2ffab1210333cb471';
export const EXPECTED_VERSION='3f6a3050-b987-4a74-8f12-42fd5bea500f';
export async function verifySameVersion({account,token,githubToken,approval,repository,attempt,fetchImpl=fetch}){
 if(approval!=='sexy00-same-current-version-once'||repository!=='nning00/sexy00-profile-sync'||String(attempt)!=='1')throw Error('Explicit single-attempt authorization missing');
 if(!/^[a-f0-9]{32}$/.test(account||'')||!token)throw Error('Existing sexy00 credentials missing');
 if(!githubToken)throw Error('Existing GitHub Actions token missing');
 const ghBase='https://api.github.com/repos/nning00/sexy00-profile-sync/';
 async function readGithub(path){
  const response=await fetchImpl(ghBase+path,{headers:{Authorization:'Bearer '+githubToken,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('GitHub state unavailable; stop');
  return await response.json();
 }
 async function assertGuards(){
  const main=await readGithub('git/ref/heads/main');
  if(main.object?.sha!==EXPECTED_MAIN)throw Error('Main changed; stop before production operation');
  const sync=await readGithub('actions/workflows/profile-sync.yml');
  if(sync.state!=='disabled_manually')throw Error('Sync is not paused; stop before production operation');
  const recent=await readGithub('actions/workflows/profile-sync.yml/runs?per_page=100');
  if(!Array.isArray(recent.workflow_runs)||recent.workflow_runs.some(run=>run?.status!=='completed'))throw Error('Sync run outstanding or unknown; stop');
 }
 await assertGuards();
 const endpoint='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/sexy00-site/deployments';
 async function read(){
  const r=await fetchImpl(endpoint,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
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
 await assertGuards();
 const immediate=await read();
 if(immediate.id!==before.id)throw Error('Deployment changed during health check');
 let createdDeployment;
 try{
  // Exactly one POST. No retry if outcome is ambiguous.
  const r=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({strategy:'percentage',versions:[{version_id:EXPECTED_VERSION,percentage:100}],annotations:{'workers/message':'Approved sexy00 same-current-version rollback capability verification'}}),
   redirect:'error',signal:AbortSignal.timeout(20000)});
  const d=await r.json();
  if(!r.ok||d.success!==true)throw Error('Same-version submission rejected');
  createdDeployment=d.result?.id;
  if(!/^[a-f0-9-]{36}$/.test(createdDeployment||'')||createdDeployment===before.id)throw Error('POST deployment identity unavailable');
 }catch(error){
  throw Error('Same-version submission failed or outcome unknown; DO NOT RETRY automatically',{cause:error});
 }
 const after=await read();
 if(after.id!==createdDeployment)throw Error('Active deployment does not match the POST response; do not retry');
 await health();
 return {worker:'sexy00-site',version:EXPECTED_VERSION,beforeDeployment:before.id,afterDeployment:after.id,submitted:true,health:'passed',sameVersionVerified:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const out=await verifySameVersion({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN,githubToken:process.env.GITHUB_TOKEN,approval:process.env.APPROVED_OPERATION,repository:process.env.GITHUB_REPOSITORY,attempt:process.env.GITHUB_RUN_ATTEMPT});
 console.log(JSON.stringify(out));
}
