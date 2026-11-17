"use client";

import { useRef,useState,type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ADULT_PUBLISH_BATCH,reviewSelectionKey,selectedReviewRows,checkPublishedProfileUrl,type AdultPublishMode,type AdultReviewSelection,type CheckedUrl } from "@/lib/adult-publish-selection";
import { publishAdultBatch } from "./actions";

type ReviewRow = AdultReviewSelection & { name:string };
type Ready = ReviewRow & { slug:string };
type Pending = ReviewRow & { content:ReactNode };

export default function PublishAdultProfiles({ pending,pendingError,ready }: {pending:Pending[];pendingError:boolean;ready:Ready[]|null}) {
  const router=useRouter();
  const running=useRef(false);
  const [selected,setSelected]=useState(new Set<string>());
  const [selectedReady,setSelectedReady]=useState(new Set<string>());
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState("");
  const [result,setResult]=useState<{checks:CheckedUrl[];failures:string[];unprocessed:number}|null>(null);
  const chosen=selectedReviewRows(pending,selected);
  const chosenReady=selectedReviewRows(ready??[],selectedReady);

  function toggleRow(row:ReviewRow, checked:boolean, existing=false) {
    const key=reviewSelectionKey(row);
    (existing?setSelectedReady:setSelected)(current=>{
      const next=new Set(current);
      if(checked)next.add(key);else next.delete(key);
      return next;
    });
  }

  async function publish(rows:ReviewRow[],mode:AdultPublishMode,scope:string){
    if(running.current || !rows.length)return;
    const confirmAdult=mode==="confirm-and-publish";
    const message=confirmAdult
      ? `你確定已逐一查核${scope} ${rows.length} 筆資料，並確認每位本人已滿 18 歲？確認後會立即發布到前台，其他資料不變。`
      : `確定補發已勾選的 ${rows.length} 筆已確認成年資料？其他資料不變。`;
    if(!window.confirm(message))return;
    running.current=true;setBusy(true);setResult(null);
    const checks:CheckedUrl[]=[];
    const failures:string[]=[];
    const paths:string[]=[];
    const names=new Map(rows.map(row=>[row.id,row.name]));
    let processed=0;
    try {
      for(let index=0;index<rows.length;index+=ADULT_PUBLISH_BATCH){
        setProgress(`正在上架 ${processed}/${rows.length} 筆…`);
        const batch=rows.slice(index,index+ADULT_PUBLISH_BATCH).map(({id,version})=>({id,version}));
        const response=await publishAdultBatch(batch,mode,confirmAdult);
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
      setResult({checks,failures,unprocessed:rows.length-processed});
      if(confirmAdult)setSelected(new Set());else setSelectedReady(new Set());
      setBusy(false);setProgress("");running.current=false;router.refresh();
    }
  }
  const problems=result?.checks.filter(x=>x.status!==200 || x.redirected)??[];
  const publishSelected=()=>publish(chosen,"confirm-and-publish","已勾選的");
  return <>
    <section aria-labelledby="adult-publish-title" className="admin-review-ready" aria-busy={busy}>
      <h2 id="adult-publish-title">一鍵確認成年並上架</h2>
      <p>整頁都已查核，可以一鍵處理本頁。只查核部分時，請在下方勾選，未勾選的資料會繼續待審。</p>
      <div className="admin-review-all-form">
        <button className="admin-review-all-button" type="button" disabled={busy || !pending.length || !!chosen.length}
          onClick={()=>publish(pending,"confirm-and-publish","本頁全部")}>一鍵確認並上架本頁（{pending.length} 筆）</button>
        <button type="button" disabled={busy || !chosen.length} onClick={publishSelected}>保存並上架勾選（{chosen.length} 筆）</button>
        {!!chosen.length && <button type="button" disabled={busy} onClick={()=>setSelected(new Set())}>取消勾選</button>}
      </div>
      {ready===null && <p className="admin-error">無法讀取補發資料，請重新整理後再試。</p>}
      {!!ready?.length && <details>
        <summary>補發已確認但尚未上架的資料（{ready.length} 筆）</summary>
        <div className="admin-review-all-form">
          <button type="button" disabled={busy || chosenReady.length===ready.length}
            onClick={()=>setSelectedReady(new Set(ready.map(reviewSelectionKey)))}>全選可補發資料</button>
          <button type="button" disabled={busy || !chosenReady.length}
            onClick={()=>publish(chosenReady,"publish-existing","")}>補發勾選（{chosenReady.length} 筆）</button>
        </div>
        <ul className="admin-review-selection">{ready.map(row=><li key={reviewSelectionKey(row)}>
          <label><input type="checkbox" disabled={busy} checked={selectedReady.has(reviewSelectionKey(row))}
            onChange={event=>toggleRow(row,event.currentTarget.checked,true)} />{row.name}</label><small>/profiles/{row.slug}</small>
        </li>)}</ul>
      </details>}
    </section>
    <div role="status" aria-live="polite">{progress}</div>
    {result && <div className="admin-review-result" role="status">
      <p>已上架 {result.checks.length} 筆；原網址正常 {result.checks.length-problems.length} 筆，404 {problems.filter(x=>x.status===404).length} 筆，其他異常 {problems.filter(x=>x.status!==404).length} 筆。</p>
      {!!problems.length && <ul>{problems.map(x=><li key={x.path}><a href={x.path} target="_blank" rel="noopener noreferrer">{x.path}</a>：{x.status??"連線失敗"}{x.redirected?"（有轉址）":""}</li>)}</ul>}
      {!!result.failures.length && <ul>{result.failures.map((message,index)=><li key={index}>{message}</li>)}</ul>}
      {!!result.unprocessed && <p>{result.unprocessed} 筆未取得結果。</p>}
    </div>}
    <h2 id="adult-pending-title">尚待成年確認</h2>
    <section className="admin-review-grid" aria-labelledby="adult-pending-title">
      {pending.map(row=><article className="admin-review-card" key={reviewSelectionKey(row)}>
        {row.content}
        <label className="admin-check-row admin-review-row-choice">
          <input type="checkbox" disabled={busy} checked={selected.has(reviewSelectionKey(row))}
            onChange={event=>toggleRow(row,event.currentTarget.checked)} aria-label={`確認 ${row.name} 已成年並選取上架`} />
          已查核滿 18 歲，選取上架
        </label>
      </article>)}
      {!pending.length && !pendingError && <div className="admin-review-empty"><h2>這一頁沒有待確認資料</h2></div>}
    </section>
    {!!pending.length && <div className="admin-review-all-form admin-review-bottom">
      <button className="admin-review-all-button" type="button" onClick={publishSelected} disabled={busy || !chosen.length}>
        保存並上架勾選（{chosen.length} 筆）
      </button>
    </div>}
  </>;
}
