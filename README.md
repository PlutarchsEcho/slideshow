# Slideshow PWA

A local-first image slideshow. No uploads, no server, no account.

## Features
- Drag & drop folders (or use picker) — images stay on your device
- Mix images from multiple folders
- Fade or slide transitions
- Adjustable timing (1–30 seconds)
- Shuffle mode
- Auto-hiding controls with floating overlay
- Fullscreen mode
- Keyboard shortcuts: `Space` play/pause · `←/→` prev/next · `F` fullscreen · `S` shuffle
- Supports: JPG, PNG, GIF, WebP, HEIC, HEIF, AVIF, TIFF, BMP, SVG

## Deployment

### GitHub Pages (recommended)
1. Create a new GitHub repo (e.g. `slideshow`)
2. Push this folder's contents
3. Go to repo Settings → Pages → Deploy from branch `main` / `/ (root)`
4. Your app is live at `https://yourusername.github.io/slideshow/`

### PWA Install
Once on GitHub Pages, open in Safari/Chrome and use "Add to Home Screen".
Works offline after first load.

### Local use
Just open `slideshow.html` directly in any modern browser.
No server needed for basic use (drag & drop folders).

## Files
- `slideshow.html` — the entire app
- `manifest.json` — PWA manifest
- `sw.js` — service worker (offline cache)
- `icons/` — app icons
- `index.html` — redirects to slideshow.html
