// Fail-closed release policy. No production I/O in this module.
export function releaseIdentity({event,ref,sha,expectedSha,runAttempt}) {
 if(event!=='workflow_dispatch'||ref!=='refs/heads/main'||sha!==expectedSha||!/^[a-f0-9]{40}$/.test(sha)||Number(runAttempt)!==1)throw Error('RELEASE_IDENTITY_REF_OR_RERUN_REFUSED');
}
export function previousReleaseGate(runs,currentRunId){
 if(!Array.isArray(runs))throw Error('HISTORY_UNAVAILABLE');
 const prior=runs.filter(r=>String(r.id)!==String(currentRunId)).sort((a,b)=>Number(b.run_number)-Number(a.run_number));
 if(prior[0] && (prior[0].status!=='completed'||prior[0].conclusion!=='success'))throw Error('PREVIOUS_RELEASE_NOT_SUCCESSFUL_OPERATOR_REQUIRED');
}
export function soleVersion(deployment){
 if(!deployment||!Array.isArray(deployment.versions)||deployment.versions.length!==1||deployment.versions[0].percentage!==100||!String(deployment.versions[0].version_id).match(/^[a-f0-9-]{36}$/))throw Error('AMBIGUOUS_ACTIVE_VERSION');
 return deployment.versions[0].version_id;
}
export async function controlledRelease(io){
 await io.validate();
 const previous=await io.active();
 await io.assertPrevious(previous);
 await io.assertSyncDisabled();
 await io.oldHealth();
 await io.persist({phase:'baseline',previous});
 const uploaded=await io.upload();
 await io.persist({phase:'uploaded',previous,uploaded});
 if(await io.active()!==previous)throw Error('BASELINE_DRIFT_BEFORE_ACTIVATION');
 await io.assertMainUnchanged();
 let attempted=false;
 try{
  attempted=true;await io.activate(uploaded);
  if(await io.active()!==uploaded)throw Error('NEW_VERSION_NOT_ACTIVE');
  await io.newHealth();
  await io.persist({phase:'healthy',previous,uploaded});
  return {previous,uploaded,syncRemainsDisabled:true};
 }catch(error){
  if(!attempted)throw error;
  let current;
  try{current=await io.active();}catch{await io.persist({phase:'FAILED_UNKNOWN_ACTIVE_MANUAL_RECOVERY',previous,uploaded});throw Error('UNKNOWN_ACTIVE_VERSION_NO_BLIND_ROLLBACK',{cause:error});}
  if(current!==previous&&current!==uploaded){await io.persist({phase:'FAILED_EXTERNAL_DRIFT',previous,uploaded,current});throw Error('EXTERNAL_DRIFT_NO_BLIND_ROLLBACK',{cause:error});}
  if(current===uploaded){await io.rollback(previous);}
  if(await io.active()!==previous)throw Error('ROLLBACK_VERSION_UNVERIFIED',{cause:error});
  await io.oldHealth();
  await io.persist({phase:'FAILED_ROLLED_BACK',previous,uploaded});
  throw Error('RELEASE_FAILED_SYNC_STAYS_DISABLED',{cause:error});
 }
}

