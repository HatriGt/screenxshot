import { useEffect } from "react";

// Layered 3D parallax (scroll + pointer), ported verbatim from prism.html.
export function useParallax() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const hero = document.querySelector(".hero"),
      layers = [].slice.call(document.querySelectorAll(".player"));
    if (!hero || !layers.length) return;
    let mx = 0, my = 0, tmx = 0, tmy = 0, sy = window.scrollY, ticking = false;
    function apply() {
      mx += (tmx - mx) * 0.12;
      my += (tmy - my) * 0.12;
      layers.forEach((l) => {
        const d = parseFloat(l.dataset.depth || 0);
        l.style.transform =
          "translate3d(" + (mx * d * 46).toFixed(2) + "px," + (sy * d + my * d * 46).toFixed(2) + "px,0)";
      });
      if (Math.abs(tmx - mx) > 0.001 || Math.abs(tmy - my) > 0.001) requestAnimationFrame(apply);
      else ticking = false;
    }
    function req() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(apply);
      }
    }
    const onScroll = () => {
      sy = window.scrollY;
      req();
    };
    const onMove = (e) => {
      const r = hero.getBoundingClientRect();
      tmx = (e.clientX - r.left) / r.width - 0.5;
      tmy = (e.clientY - r.top) / r.height - 0.5;
      req();
    };
    const onLeave = () => {
      tmx = 0;
      tmy = 0;
      req();
    };
    addEventListener("scroll", onScroll, { passive: true });
    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerleave", onLeave);
    req();
    return () => {
      removeEventListener("scroll", onScroll);
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
    };
  }, []);
}
