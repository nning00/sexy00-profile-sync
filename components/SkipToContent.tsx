"use client";

export default function SkipToContent() {
  return <a className="skip-link" href="#main-content" onClick={(event) => {
    const content = document.getElementById("main-content") ?? document.querySelector("main");
    if (!content) return;
    event.preventDefault();
    content.tabIndex = -1;
    content.focus({ preventScroll: true });
    content.scrollIntoView({ block: "start", behavior: "instant" });
  }}>跳到主要內容</a>;
}
