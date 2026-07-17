import { editor } from "@screenxshot/editor";

export default function Hero() {
  return (
    <section className="hero">
      <div className="hero-bg">
        <svg className="skysvg player" data-depth="0.05" viewBox="0 0 1600 720" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#9fcdff" />
              <stop offset="0.5" stopColor="#cbe6ff" />
              <stop offset="1" stopColor="#eef4fb" />
            </linearGradient>
            <radialGradient id="sun" cx="0.78" cy="0.12" r="0.5">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="spectral" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ff6b6b" />
              <stop offset="0.3" stopColor="#ffd93b" />
              <stop offset="0.55" stopColor="#4be0a0" />
              <stop offset="0.8" stopColor="#4ba7ff" />
              <stop offset="1" stopColor="#9b6bff" />
            </linearGradient>
            <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="26" />
            </filter>
            <filter id="soft2" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="52" />
            </filter>
          </defs>
          <rect width="1600" height="720" fill="url(#sky)" />
          <rect width="1600" height="720" fill="url(#sun)" />
          <g opacity="0.5" filter="url(#soft2)">
            <rect x="120" y="120" width="1500" height="120" transform="rotate(-18 900 300)" fill="url(#spectral)" opacity="0.35" />
          </g>
          <g fill="#ffffff" filter="url(#soft)">
            <ellipse cx="1180" cy="250" rx="360" ry="120" opacity="0.92" />
            <ellipse cx="1360" cy="200" rx="240" ry="96" opacity="0.85" />
            <ellipse cx="990" cy="300" rx="220" ry="80" opacity="0.8" />
            <ellipse cx="300" cy="560" rx="360" ry="120" opacity="0.9" />
            <ellipse cx="520" cy="600" rx="260" ry="96" opacity="0.85" />
            <ellipse cx="900" cy="640" rx="480" ry="130" opacity="0.7" />
            <ellipse cx="1500" cy="560" rx="320" ry="110" opacity="0.75" />
          </g>
          <g stroke="#12141a" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.5">
            <path d="M760 210 q10 -12 20 0 q10 -12 20 0" />
            <path d="M700 250 q8 -10 16 0 q8 -10 16 0" />
          </g>
        </svg>
        <svg className="player layer-sun" data-depth="0.11" viewBox="0 0 600 600" aria-hidden="true">
          <defs>
            <radialGradient id="sunglow" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="0.45" stopColor="#ffe9c2" stopOpacity="0.55" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="300" cy="300" r="300" fill="url(#sunglow)" />
        </svg>
        <svg className="player layer-shards" data-depth="0.3" viewBox="0 0 1600 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <linearGradient id="shardg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#7db9ff" stopOpacity="0.55" />
              <stop offset="1" stopColor="#b79bff" stopOpacity="0.18" />
            </linearGradient>
          </defs>
          <g opacity="0.72">
            <rect x="1055" y="120" width="150" height="150" rx="30" fill="url(#shardg)" transform="rotate(18 1130 195)" />
            <rect x="300" y="360" width="92" height="92" rx="20" fill="url(#shardg)" transform="rotate(-12 346 406)" />
            <path d="M1360 430 l72 -122 l72 122 z" fill="url(#shardg)" />
          </g>
        </svg>
        <svg className="player layer-front" data-depth="0.2" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <defs>
            <filter id="frontblur" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="26" />
            </filter>
          </defs>
          <g fill="#ffffff" filter="url(#frontblur)">
            <ellipse cx="240" cy="330" rx="360" ry="120" opacity="0.95" />
            <ellipse cx="640" cy="360" rx="300" ry="110" opacity="0.9" />
            <ellipse cx="1180" cy="330" rx="420" ry="130" opacity="0.92" />
            <ellipse cx="1500" cy="370" rx="280" ry="110" opacity="0.85" />
          </g>
        </svg>
      </div>

      <div className="shell hero-inner">
        <div className="hleft reveal">
          <span className="badge">
            <span className="d"></span>Screenshots, beautifully
          </span>
          <h1>
            Every screenshot, <span className="h-accent">instantly beautiful.</span>
            <svg className="doodle d1" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M20 4v12M20 24v12M4 20h12M24 20h12" />
            </svg>
            <svg className="doodle d2" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M6 20 Q20 4 34 20" />
            </svg>
            <svg className="doodle d3" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M8 28 L20 8 L32 28" />
            </svg>
          </h1>
        </div>
        <div className="hright reveal" style={{ transitionDelay: ".1s" }}>
          <p>
            ScreenXShot sets your screenshot on a beautiful backdrop, wraps it in a clean frame, and lets you mark it up — then copy or save. All in the browser, nothing uploaded.
          </p>
          <div className="cta">
            <button className="pill pill-dark" id="heroPaste" onClick={() => editor.pick()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <rect x="8" y="4" width="12" height="16" rx="2" />
                <path d="M8 8H6a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2" />
              </svg>
              Paste a screenshot
            </button>
          </div>
          <div className="pastehint">
            <span>or press</span>
            <kbd>⌘ V</kbd>
            <span>/</span>
            <kbd>Ctrl V</kbd>
            <span>anywhere</span>
          </div>
        </div>
      </div>
    </section>
  );
}
