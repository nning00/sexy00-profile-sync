"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { verifyAdultBatch } from "./actions";

export default function VerifyAllAdultProfiles({ profileIds }: { profileIds: string[] }) {
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [done,setDone]=useState(0);
  const [error,setError]=useState("");
  async function review(){
    if(busy || !window.confirm(`你確定已逐一核實目前 ${profileIds.length} 筆資料全部年滿 18 歲嗎？\n\n確認後會立即發布並保存人工確認紀錄。`))return;
    setBusy(true);setError("");let completed=0;
    try{
      for(let i=0;i<profileIds.length;i+=3){
        const result=await verifyAdultBatch(profileIds.slice(i,i+3));
        completed+=result.verified;setDone(completed);
        if(result.error)throw new Error(result.error);
      }
      router.replace(`/admin/profiles/adult-review?verified_all=${completed}`);
      router.refresh();
    }catch(e){setError(`${e instanceof Error?e.message:"連線失敗"}。已完成 ${completed} 筆；請重新整理後再處理剩餘資料。`);}
    finally{setBusy(false);}
  }
  return <div className="admin-review-all-form">
    <button className="admin-review-all-button" type="button" disabled={busy || !!error || !profileIds.length} onClick={review}>
      {busy?`正在保存確認紀錄 ${done}/${profileIds.length}…`:`一鍵確認目前 ${profileIds.length} 筆`}
    </button>
    <small>只確認本次列出的資料；分批保存，避免一次處理太多而卡住。</small>
    {error && <p className="admin-error" role="alert">{error}</p>}
  </div>;
}
