export const ADULT_PUBLISH_BATCH = 3;
export type AdultReviewSelection = {id:string;version:string};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validReviewSelection(value: unknown): value is AdultReviewSelection[] {
  if (!Array.isArray(value) || !value.length || value.length > ADULT_PUBLISH_BATCH) return false;
  const unique=new Set<string>();
  return value.every(item=>{
    if (!item || typeof item.id!=="string" || !UUID.test(item.id) || unique.has(item.id.toLowerCase())
      || typeof item.version!=="string" || !/^\d{4}-\d\d-\d\dT/.test(item.version) || item.version.length>40 || !Number.isFinite(Date.parse(item.version))) return false;
    unique.add(item.id.toLowerCase());
    return true;
  });
}

export function selectedReviewRows<T extends AdultReviewSelection>(rows: T[], ids: ReadonlySet<string>) {
  return rows.filter(row=>ids.has(row.id));
}

export type CheckedUrl = {path:string;status:number|null;redirected:boolean};
export async function checkPublishedProfileUrl(
  path:string, request:typeof fetch=fetch, pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),
):Promise<CheckedUrl> {
  if (!/^\/profiles\/[a-z0-9_%.-]+$/i.test(path)) return {path,status:null,redirected:false};
  for(let attempt=0;attempt<2;attempt++){
    try{
      const result=await request(path,{cache:"no-store",credentials:"omit",signal:AbortSignal.timeout(10000)});
      const redirected=result.redirected;
      await result.body?.cancel().catch(()=>{});
      if(attempt===1 || (result.status!==404 && result.status<500))return {path,status:result.status,redirected};
    }catch{if(attempt===1)return {path,status:null,redirected:false};}
    await pause(1000);
  }
  return {path,status:null,redirected:false};
}
