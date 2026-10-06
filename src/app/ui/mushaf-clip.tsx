"use client";

// The Mushaf clip for the Quran search stage, shown exactly as delivered (no frame, card or
// styling around it): its edges fade into the page background #FBF7EF. Mounted only once a
// search starts, so the home page never downloads it. Reduced motion shows the still first frame.

import { useEffect, useRef } from "react";

export function MushafClip() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (reduce.matches) {
        video.pause();
        video.currentTime = 0;
      } else {
        void video.play().catch(() => {});
      }
    };
    apply();
    reduce.addEventListener("change", apply);
    return () => reduce.removeEventListener("change", apply);
  }, []);

  return (
    <video ref={ref} className="mushaf-clip" muted loop playsInline preload="auto" aria-hidden="true" tabIndex={-1} disablePictureInPicture>
      <source src="/mushaf-hd.webm" type="video/webm" />
      <source src="/mushaf-hd.mp4" type="video/mp4" />
    </video>
  );
}
