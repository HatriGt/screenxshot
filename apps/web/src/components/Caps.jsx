export default function Caps() {
  return (
    <section className="caps" id="caps">
      <div className="shell reveal">
        <span className="mono">Everything in one window</span>
        <h2 style={{ marginTop: "12px" }}>Small tool, whole job.</h2>
        <p className="s">No account, no upload, no server. Your screenshot never leaves this browser tab.</p>
        <div className="caprow">
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
            </svg>
            <b>13 wallpapers</b> &amp; gradients
          </span>
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 9h18" />
            </svg>
            <b>Browser frame</b>
          </span>
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 5l4 4L8 20l-4 1 1-4L15 5z" />
            </svg>
            <b>Pen, arrow, text</b>
          </span>
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 2v14a2 2 0 002 2h14" />
              <path d="M2 6h14a2 2 0 012 2v14" />
            </svg>
            <b>Crop &amp; erase</b>
          </span>
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
            <b>Copy or save PNG</b>
          </span>
        </div>
      </div>
    </section>
  );
}
