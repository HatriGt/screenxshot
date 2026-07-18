import { useEffect } from "react";

// Header scrolled state + IntersectionObserver scroll-reveal (ported verbatim).
export function useReveal() {
  useEffect(() => {
    const hdr = document.getElementById("hdr");
    const onScroll = () => hdr && hdr.classList.toggle("scrolled", window.scrollY > 8);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    let io;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (es) =>
          es.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io.unobserve(e.target);
            }
          }),
        { threshold: 0.08 }
      );
      document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    } else document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
    return () => {
      removeEventListener("scroll", onScroll);
      io && io.disconnect();
    };
  }, []);
}
