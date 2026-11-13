// Read only: credentials are sent only to the official Cloudflare API.
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!account || !/^[a-f0-9]{32}$/.test(account) || !token) throw new Error('Existing sexy00 Cloudflare credentials unavailable');
const endpoint='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/sexy00-site/deployments';
const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
const data=await response.json();
if(!response.ok || data.success!==true) throw new Error('Read-only deployment lookup failed: HTTP '+response.status);
const deployments=data.result?.deployments??data.result;
if(!Array.isArray(deployments)||!deployments.length)throw new Error('No deployment baseline');
const latest=deployments[0];
if(latest.versions?.length!==1||latest.versions[0].percentage!==100)throw new Error('Unexpected split deployment; stop');
console.log(JSON.stringify({worker:'sexy00-site',deployment:latest.id,created_on:latest.created_on,versions:latest.versions,readOnly:true,rollbackValidated:false}));
