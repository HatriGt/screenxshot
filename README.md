# screenxshot

**Prism** — every screenshot, instantly beautiful.

A privacy-first, client-side screenshot beautifier and annotator. Drop in a
screenshot and Prism sets it on a beautiful backdrop, wraps it in a clean
macOS-style window frame, lets you mark it up, then copy or save as PNG. No
account, no upload, no server — your screenshot never leaves the browser tab.

## Tech stack

React + Vite + TanStack Router + TanStack Store. Migrated from a single
`prism.html` file with 100% UI and functionality parity.

## Getting started

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build → dist/
npm run preview   # preview the build
```

See [AGENT.md](./AGENT.md) for architecture and contributor notes.
