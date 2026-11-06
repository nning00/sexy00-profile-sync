"use client";
import { useRef, useState } from "react";

async function call(action: string, source?: string) {
  const response = await fetch("/api/admin/media-isolation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, source }) });
  const result = await response.json() as { error?: string; project?: string; sources?: string[]; repaired?: number; preservedCurrentImages?: number; updated?: number; bytes?: number; remainingSources?: number; remainingReferences?: number; restored?: number };
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

export default function MediaIsolation() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ total: 0, done: 0, failed: 0, updated: 0, bytes: 0 });
  const [message, setMessage] = useState("準備完成；可中止後重新執行，已完成的引用不會重複處理。");
  const stopped = useRef(false);
  async function start() {
    stopped.current = false;
    setRunning(true);
    let done = 0, failed = 0, updated = 0, bytes = 0;
    try {
      setMessage("正在核對 sexy00 圖片引用...");
      const plan = await call("plan");
      if (plan.project !== "kkxsclcqdxoiqucunpur") throw new Error("專案不符，已停止");
      if (!Array.isArray(plan.sources) || plan.sources.some(source => typeof source !== "string")) throw new Error("圖片清單格式錯誤，已停止");
      const sources = plan.sources;
      setProgress({ total: sources.length, done, failed, updated, bytes });
      const repair = await call("repair");
      setMessage(`缺圖修復：${repair.repaired} 筆舊失效引用已備份處理；保留 ${repair.preservedCurrentImages} 張目前有效照片。正在逐張複製，請保留此分頁。`);
      let index = 0;
      // Bounded one-off static file copying, no full-site crawl or source writes.
      async function worker() {
        while (!stopped.current && index < sources.length) {
          const source = sources[index++];
          let success = false;
          for (let attempt = 0; attempt < 3 && !stopped.current; attempt++) {
            try {
              const result = await call("copy", source);
              updated += result.updated ?? 0;
              bytes += result.bytes ?? 0;
              success = true;
              break;
            } catch {
              await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            }
          }
          if (!success) failed++;
          done++;
          setProgress({ total: sources.length, done, failed, updated, bytes });
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }
      await Promise.all(Array.from({ length: 16 }, () => worker()));
      const final = await call("finish");
      setMessage(`${stopped.current ? "已停止" : "本輪完成"}；仍有 ${final.remainingSources} 張外站圖片、${final.remainingReferences} 筆引用待處理。失敗引用保留，可再次執行。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "執行失敗"); }
    finally { setRunning(false); }
  }
  async function restoreGallery() {
    setRunning(true);
    try { const result = await call("restore-gallery"); setMessage(`已從備份恢復 ${result.restored} 筆原相簿引用。`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "恢復失敗"); }
    finally { setRunning(false); }
  }
  return <section><p role="status">{message}</p><p>進度：{progress.done} / {progress.total}；失敗：{progress.failed}；已更新引用：{progress.updated}；已複製：{(progress.bytes / 1024 / 1024).toFixed(1)} MB</p><progress max={progress.total || 1} value={progress.done} style={{ width: "100%" }} /><div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16 }}><button disabled={running} onClick={start}>開始／繼續圖片獨立化</button><button disabled={!running} onClick={() => { stopped.current = true; }}>安全停止（保留進度）</button><button disabled={running} onClick={restoreGallery}>從備份恢復三筆舊相簿引用</button><a href="/admin">返回後台</a></div></section>;
}
