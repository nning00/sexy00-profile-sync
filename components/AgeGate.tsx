"use client";

import { useEffect, useState } from "react";

const storageKey = "site-age-confirmed";

export default function AgeGate() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(window.localStorage.getItem(storageKey) !== "yes"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function confirmAge() {
    window.localStorage.setItem(storageKey, "yes");
    setVisible(false);
  }

  function leaveSite() {
    window.location.href = "https://www.google.com/";
  }

  if (!visible) return null;

  return (
    <div className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-title">
      <div className="age-card">
        <div className="age-mark">18+</div>
        <p className="eyebrow">ADULTS ONLY</p>
        <h2 id="age-title">年齡確認</h2>
        <p>本網站包含成人形象內容，僅供年滿 18 歲的成年人瀏覽。進入即表示你已達法定成年年齡。</p>
        <div className="age-actions">
          <button className="button primary" type="button" onClick={confirmAge}>我已年滿 18 歲</button>
          <button className="age-exit" type="button" onClick={leaveSite}>未滿 18 歲，離開網站</button>
        </div>
        <small>我們重視合法、尊重、隱私與雙方同意。</small>
      </div>
    </div>
  );
}
