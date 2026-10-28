"use client";

import { useFormStatus } from "react-dom";
import { verifyAllAdultProfiles } from "./actions";

function SubmitButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return <button className="admin-review-all-button" disabled={pending || count === 0} type="submit">
    {pending ? "正在確認並發布…" : `一鍵確認目前 ${count} 筆`}
  </button>;
}

export default function VerifyAllAdultProfiles({ profileIds }: { profileIds: string[] }) {
  const count = profileIds.length;
  return <form
    action={verifyAllAdultProfiles}
    className="admin-review-all-form"
    onSubmit={(event) => {
      if (!window.confirm(`你確定已逐一核實目前 ${count} 筆資料全部年滿 18 歲嗎？\n\n確認後會立即發布到前台，且無法用一個按鈕全部復原。`)) {
        event.preventDefault();
      }
    }}
  >
    <input name="profile_ids" type="hidden" value={profileIds.join(",")} />
    <SubmitButton count={count} />
    <small>只確認目前頁面列出的資料；同步期間後續新增的待確認資料不會被一起發布。</small>
  </form>;
}
