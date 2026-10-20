"use client";
import { useEffect } from "react";
// Content stays visible without JS; motion is opted in only once this runs.
export function Reveal() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.motion = "on";
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add("in");
          io.unobserve(e.target);
        }),
      { rootMargin: "0px 0px -12% 0px" },
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      delete root.dataset.motion;
    };
  }, []);
  return null;
}
