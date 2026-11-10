"use client";

import { useRef,useState } from "react";
import { useRouter } from "next/navigation";
import { ADULT_PUBLISH_BATCH,selectedReviewRows,checkPublishedProfileUrl,type AdultReviewSelection,type CheckedUrl } from "@/lib/adult-publish-selection";
import { publishAdultBatch } from "./actions";

type Ready = AdultReviewSelection & { name:string;slug:string };

export default function PublishAdultProfiles({ rows }: {rows:Ready[]}) {
  const router=useRouter();
  const running=useRef(false);
  const [selected,setSelected]=useState(new Set<string>());
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState("");
  const [result,setResult]=useState<{checks:CheckedUrl[];failures:string[];unprocessed:number}|null>(null);
  const chosen=selectedReviewRows(rows,selected);

  async function publish(){
    if(running.current || !chosen.length || !window.confirm(`確定上架已勾選的 ${chosen.length} 筆已確認資料？未勾選的資料不會變更。`))return;
    running.current=true;setBusy(true);setResult(null);
    const checks:CheckedUrl[]=[];
    const failures:string[]=[];
    const paths:string[]=[];
    const names=new Map(chosen.map(row=>[row.id,row.name]));
    let processed=0;
    try {
      for(let index=0;index<chosen.length;index+=ADULT_PUBLISH_BATCH){
        setProgress(`正在上架 ${processed}/${chosen.length} 筆…`);
        const batch=chosen.slice(index,index+ADULT_PUBLISH_BATCH).map(({id,version})=>({id,version}));
        const response=await publishAdultBatch(batch);
        if(response.error)throw new Error(response.error);
        for(const {path} of response.published)paths.push(path);
        for(const {id,reason} of response.failed)failures.push(`${names.get(id)??"已選資料"}：${reason}`);
        processed+=batch.length;
      }
    }catch{failures.push("批次連線中斷；未回報結果的批次請重新整理核對，避免重複操作。");}
    try{
      for(let index=0;index<paths.length;index+=ADULT_PUBLISH_BATCH){
        setProgress(`正在檢查原網址 ${index}/${paths.length}…`);
        checks.push(...await Promise.all(paths.slice(index,index+ADULT_PUBLISH_BATCH).map(path=>checkPublishedProfileUrl(path))));
      }
    }finally{
      setResult({checks,failures,unprocessed:chosen.length-processed});
      setSelected(new Set());setBusy(false);setProgress("");running.current=false;router.refresh();
    }
  }
  const problems=result?.checks.filter(x=>x.status!==200 || x.redirected)??[];
  return <section aria-labelledby="adult-ready-title" className="admin-review-ready">
    <h2 id="adult-ready-title">已確認成年，待上架</h2>
    <p>只有完成個別成年確認的資料會出現在這裡。全選只會勾選，不會立即發布。</p>
    {rows.length>0 && <>
      <div className="admin-review-all-form">
        <button type="button" disabled={busy || chosen.length===rows.length} onClick={()=>setSelected(new Set(rows.map(row=>row.id)))}>全選已確認（{rows.length} 筆）</button>
        <button type="button" disabled={busy || !chosen.length} onClick={()=>setSelected(new Set())}>取消選取</button>
        <button className="admin-review-all-button" type="button" disabled={busy || !chosen.length} onClick={publish}>批次上架（已選 {chosen.length} 筆）</button>
      </div>
      <ul className="admin-review-selection">{rows.map(row=><li key={row.id}>
        <label><input type="checkbox" disabled={busy} checked={selected.has(row.id)} onChange={event=>{
          const checked=event.currentTarget.checked;
          setSelected(current=>{const next=new Set(current);if(checked)next.add(row.id);else next.delete(row.id);return next;});
        }} />{row.name}</label><small>/profiles/{row.slug}</small>
      </li>)}</ul>
    </>}
    {!rows.length && <p>目前沒有已確認、等待上架的資料。</p>}
    <div role="status" aria-live="polite">{progress}</div>
    {result && <div className="admin-review-result" role="status">
      <p>已上架 {result.checks.length} 筆；原網址正常 {result.checks.length-problems.length} 筆，404 {problems.filter(x=>x.status===404).length} 筆，其他異常 {problems.filter(x=>x.status!==404).length} 筆。</p>
      {!!problems.length && <ul>{problems.map(x=><li key={x.path}><a href={x.path} target="_blank" rel="noopener noreferrer">{x.path}</a>：{x.status??"連線失敗"}{x.redirected?"（有轉址）":""}</li>)}</ul>}
      {!!result.failures.length && <ul>{result.failures.map((message,index)=><li key={index}>{message}</li>)}</ul>}
      {!!result.unprocessed && <p>{result.unprocessed} 筆未取得結果。</p>}
    </div>}
  </section>;
}
