"use client";

import Image from "next/image";
import { useState, type TouchEvent } from "react";
import { isSupabaseMedia, supabaseImageLoader } from "@/lib/media-image";

type GalleryImage = { src: string; alt: string };
const isVideo = (src: string) => /\.(mp4|webm)(?:\?|$)/i.test(src);

export default function ProfileGallery({ images }: { images: GalleryImage[] }) {
  const [active, setActive] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const total = images.length;
  const move = (step: number) => setActive((current) => (current + step + total) % total);
  const finishSwipe = (event: TouchEvent<HTMLDivElement>) => {
    if (touchStart === null) return;
    const distance = event.changedTouches[0].clientX - touchStart;
    if (Math.abs(distance) > 45) move(distance < 0 ? 1 : -1);
    setTouchStart(null);
  };

  return <div className="profile-carousel" aria-label="形象照片相簿">
    <div className="profile-carousel-stage" onTouchStart={(event) => setTouchStart(event.touches[0].clientX)} onTouchEnd={finishSwipe}>
      {isVideo(images[active].src)
        ? <video key={images[active].src} src={images[active].src} controls playsInline preload="metadata" aria-label={images[active].alt} />
        : <Image src={images[active].src} alt={images[active].alt} fill preload loader={isSupabaseMedia(images[active].src) ? supabaseImageLoader : undefined} quality={64} sizes="(max-width: 800px) 100vw, 52vw" />}
      {total > 1 && <>
        <button className="profile-carousel-arrow previous" type="button" onClick={() => move(-1)} aria-label="上一張照片"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg></button>
        <button className="profile-carousel-arrow next" type="button" onClick={() => move(1)} aria-label="下一張照片"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>
        <span className="profile-carousel-count">{active + 1} / {total}</span>
      </>}
    </div>
    {total > 1 && <div className="profile-carousel-thumbs">
      {images.map((image, index) => <button className={`${index === active ? "active" : ""} ${isVideo(image.src) ? "video-thumb" : ""}`} type="button" onClick={() => setActive(index)} aria-label={`查看第 ${index + 1} 個相簿內容`} key={`${image.src}-${index}`}>
        {isVideo(image.src) ? <span aria-hidden="true">▶</span> : <Image src={image.src} alt="" fill loader={isSupabaseMedia(image.src) ? supabaseImageLoader : undefined} quality={58} sizes="76px" />}
      </button>)}
    </div>}
  </div>;
}
