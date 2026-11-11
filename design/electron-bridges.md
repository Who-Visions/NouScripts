# Electron docs to Nou Scripts: the bridge map

Source: electron/electron docs/ (sparse clone of main, 303 markdown files), tutorial/security.md and api/*.md.
Each row ties a documented rule or API to the place in this repo that uses it, and says whether it is met.

## Security checklist (tutorial/security.md)

| # | Rule | Where | Status |
|---|------|-------|--------|
| 1 | Only load secure content | window loads local file (src/renderer-dist via loadFile); no remote pages | met |
| 2 | No Node integration for remote content | src/main.js webPreferences: nodeIntegration false | met |
| 3 | Context isolation | src/main.js webPreferences: contextIsolation true; preload exposes only named functions | met |
| 4 | Process sandbox | src/main.js webPreferences: sandbox true | met |
| 5 | Permission requests from remote content | no remote content; no permission requests | n/a |
| 6 | Do not disable webSecurity | not set | met |
| 7 | CSP with script-src 'self' | ui/index.html meta CSP: default-src 'none'; script-src 'self' | met |
| 8 | No allowRunningInsecureContent | not set | met |
| 9 | No experimental features | ImageView, corner smoothing (CSS only), not API experiments | met (CSS corner smoothing is documented as experimental; kept, reversible) |
| 10 | No enableBlinkFeatures | not set | met |
| 11-12 | WebView rules | no webview | n/a |
| 13 | Limit navigation | src/main.js: will-navigate prevented | met |
| 14 | Limit new windows | src/main.js: setWindowOpenHandler denies every window | met |
| 15 | No shell.openExternal with untrusted content | openExternal only for https links, and the OS error is caught | met |
| 16 | Current Electron | electron 45.2.1 in package.json | met |
| 17 | Validate IPC sender | file:open, file:reveal, media:open, media:attach, updater:install check the sender is the app's top frame (fromAppPage) | fixed in this branch |
| 18 | Avoid file:// for local pages | thumbnails load over the nou-media:// protocol (protocol.handle in src/main.js, resolveMediaUrl in src/scripts.js); the CSP no longer allows file: | met for media. The window itself still loads with loadFile |
| 19 | Fuses | app is not packaged; fuses apply to packaging | later: set when packaging |
| 20 | Do not expose Electron APIs | preload exposes wrapped functions only, never raw ipcRenderer | met |

## APIs in use (api/*.md)

| API | Where | Docs rule that matters | Status |
|-----|-------|------------------------|--------|
| BrowserWindow | src/main.js createWindow | show on ready-to-show; size from screen work area (src/window-size.js) | met |
| screen | src/main.js refitToDisplay | listen after app ready (the module throws before it); getDisplayMatching | met; a bug was caught and fixed in PR 24 |
| webContents.setWindowOpenHandler | src/main.js | return { action: 'deny' } cancels; catch openExternal | met |
| shell | src/main.js | openPath resolves with the error text; openExternal returns a promise | met; fixed in PR 22 |
| ipcMain.handle / ipcRenderer.invoke | src/main.js, src/preload.js | validate event.sender (item 17) | fixed in this branch |
| contextBridge.exposeInMainWorld | src/preload.js | expose functions, not the module | met |
| MessageChannelMain | src/main.js withJob | port to the page through event.sender.postMessage; close ports | met (PR 17) |
| Notification | src/main.js notifyJob | isSupported check; silent; click focuses the window | met (PR 19) |
| autoUpdater | src/updater.js | setFeedURL needs a signed macOS app; quitAndInstall only when ready | met as inert until packaged (PR 18) |
| nativeTheme | src/main.js | themeSource dark | met |
| dialog.showOpenDialog | src/main.js ask:attach | passes the parent window | met |
| systemPreferences.getAnimationSettings | ui/index.css | Chromium maps the OS reduce-motion setting to the media query | met (PR 21) |
| app.isPackaged, app.getVersion | src/updater.js wiring | used to decide whether updates run | met |

## Not used, and why

ImageView (experimental; needs BaseWindow), push notifications / APNS (needs a signed app, an entitlement and a server), Touch Bar (macOS MacBook Pro only, not on this Mac mini), accent colour (would replace the gold design), camera and microphone access (not needed).
