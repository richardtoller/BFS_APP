# BFS Scores 🎼

A phone app for viewing and organising sheet music and building concert programmes.

It's an installable web app (PWA). It runs in your phone's browser, can be added to the home screen like a normal app and works offline. It needs no account and no app store, and your scores stay on your phone.

## Features

- **Import your folder**: tap **Choose the _BFS folder** and pick *Internal shared storage › songs › _BFS*. PDFs and PNG/JPEG/WebP pictures are copied into the app's storage. Tap **Update from the _BFS folder** (Library tab) after adding or changing scores: new files are added, changed ones updated, and your titles, categories and programmes are kept. If your phone only offers a file picker, open the folder and use ⋮ › **Select all**.
- **Categories**: songs start out as *Christmas* or *Non-Christmas*, guessed from the file name (Silent Night, Jingle Bells, carols and so on). Fix any song with ⋯, or tap **Select** to change many at once. Filter the list with the category chips, or search by title. Add, rename or delete categories in the Library tab.
- **Viewer**: tap a title to open the score full screen. Pinch or double-tap to zoom (up to 500%, redrawn sharp at every zoom level) and drag to move around. Tap the right or left edge to go forward or back a screen, or tap the middle to show the controls. ↕/↔ switches between fit-to-width and whole-page view. Works in portrait and landscape, keeps the screen awake, and works with Bluetooth page-turner pedals (arrow and Page Up/Down keys).
- **Concert programmes**: create a programme (name, date, venue, notes), tap **+ Songs** and tap songs in performance order. **Edit** lets you drag to reorder, remove songs and add notes such as “Interval”. **▶ Start** steps through the whole concert: when you turn past the end of one score, the next one opens, and there are prev/next buttons too. Share or copy the song list, or duplicate a programme for next year.
- **Backup**: Library › Download backup saves programmes, categories and titles (not the score files). Restore on a new phone, then import the folder again.

## Getting it onto your phone

The app is static files, so any static web host will do. The easiest is **GitHub Pages**, set up by the workflow in `.github/workflows/pages.yml`:

1. In the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. The workflow deploys on every push to `main`, or you can run it by hand from the **Actions** tab. The app's address is shown on the Settings → Pages screen (`https://<your-username>.github.io/<repository-name>/`).
3. Open that address in Chrome on your phone and tap ⋮, then **Install app** (or **Add to Home screen**).
4. Open the app and import your `_BFS` folder.

> **Your scores and programmes live on the phone**, in the app's own storage. Use **Library → Download backup** now and then.

### Running locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Project layout

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css` | App shell and styles (light and dark mode) |
| `js/app.js` | Songs, categories, programmes, importing, backup |
| `js/viewer.js` | Full-screen viewer: zoom, page turning, programme navigation |
| `js/db.js` | IndexedDB storage for the score files and app data |
| `vendor/pdfjs/` | [PDF.js](https://mozilla.github.io/pdf.js/) 4.10.38 (Apache 2.0), stored here so it works offline |
| `sw.js` | Service worker for offline use |
| `manifest.webmanifest`, `icons/` | Installable-app metadata and icons |

If you change any files, bump `CACHE` in `sw.js` so installed copies pick up the update.
