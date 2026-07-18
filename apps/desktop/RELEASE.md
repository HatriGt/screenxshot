# ScreenXShot desktop — release checklist (deferred / gated)

The desktop app builds **unsigned** bundles today (`.app` + `.dmg` on macOS,
`.msi`/`.exe` on Windows). Before any public release, complete the steps below.
None of these are done yet — they require paid accounts / secrets.

## 1. Updater signing keys
```bash
cargo tauri signer generate -w ~/.tauri/screenxshot.key
```
- Store the private key securely (never commit).
- Put the **public key** into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
  (currently `REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY`).
- In CI set `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  if the key is encrypted).
- Flip `plugins.updater.active` to `true` once an update server exists.

## 2. Update server
- Host signed installers + `.sig` files over **HTTPS**.
- Endpoint returns the Tauri update JSON (`version`, `notes`, `pub_date`,
  `platforms.{target}.{signature,url}`) at the configured
  `releases.screenxshot.com/update/{{target}}/{{current_version}}`.

## 3. macOS signing + notarization
- Apple Developer account ($99/yr).
- Env vars: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
- `cargo tauri build` handles signing + notarization when these are set.

## 4. Windows signing
- OV/EV code-signing certificate (avoids SmartScreen warnings).
- Configure `bundle.windows.certificateThumbprint` or the signing env vars.

## 5. Screen Recording permission (macOS, runtime)
- First capture triggers the OS Screen Recording prompt. Unavoidable; add a
  guide in-app when a capture returns empty/black.
