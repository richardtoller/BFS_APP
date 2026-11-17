# BFS Scores 🎼

A phone app for viewing and organising sheet music and building concert programmes.

It's an installable web app (PWA). It runs in your phone's browser, can be added to the home screen like a normal app and works offline. It needs no account and no app store, and your scores stay on your phone.

## Features

- **Import your folder**: tap **Choose the _BFS folder** and pick *Internal shared storage › songs › _BFS*. PDFs and PNG/JPEG/WebP pictures are copied into the app's storage. Only the scores directly inside the chosen folder are imported; scores in its sub-folders are skipped (the app lists them). To add a sub-folder, tap **Import a sub-folder** (Library tab) and open that sub-folder in the picker. Its songs are marked with 📁 and the folder name. Tap **Update from the _BFS folder** (Library tab) after adding or changing scores: new files are added, changed ones updated, and your titles, categories and programmes are kept. If your phone only offers a file picker, open the folder and use ⋮ › **Select all**.
- **Download from GitHub**: tap **Download from GitHub** to download the scores in a folder of a GitHub repository (set up for `richardtoller/BFS`, folder `pdf`, branch `main`; change these in **Library › GitHub settings**). Only files directly in that folder are downloaded. Tap **Update from GitHub** after changing scores there: new files are added and changed ones downloaded again (unchanged ones are skipped), and your titles, categories and programmes are kept. Songs from GitHub are marked ☁ GitHub. You can use GitHub and your local folder together.
  - A **private repository needs an access token**. On GitHub, go to *Settings › Developer settings › Personal access tokens › Fine-grained tokens*, choose *Generate new token*, pick *Only select repositories* and your scores repository, and under *Permissions* set *Contents* to *Read-only*. Paste the token into **GitHub settings**. It is stored only in the app on your phone and is never included in backups.
- **Song names**: names come from the file names with normal capitalisation, so `the_lark_in_the_morn.pdf` becomes *The Lark in the Morn* and `heres_adieu….pdf` becomes *Here’s Adieu…*. Words that already have capitals in the file name are left as they are.
- **Rename songs**: tap ⋯ beside a song and change its name. Only the name shown in the app changes: the song stays linked to its original file (shown underneath), so re-importing keeps your name, and searching still finds it by the file name. **Use the file name** puts the original name back.
- **Notes**: each score can have its own text notes (key, repeats, who sings which verse…). Add them with ⋯ beside a song, or with 📝 while viewing the score; a dot on 📝 shows a score has notes. The first line shows under the title in the song and programme lists, and search looks in notes too. Notes are included in backups.
- **Categories**: *Current* and *Christmas* to start with. Songs whose file names look Christmassy (Silent Night, Jingle Bells, carols and so on) go in Christmas automatically; everything else starts uncategorised. Fix any song with ⋯, or tap **Select** to change many at once. Filter the list with the category chips, or search by title. Add, rename or delete categories in the Library tab.
- **Viewer**: tap a title to open the score full screen. Pinch or double-tap to zoom (up to 500%, redrawn sharp at every zoom level) and drag to move around. Tap the right or left edge to go forward or back a screen, or tap the middle to show the controls. ↕/↔ switches between fit-to-width and whole-page view. Works in portrait and landscape, keeps the screen awake, and works with Bluetooth page-turner pedals (arrow and Page Up/Down keys).
- **Concert programmes**: create a programme (name, date, venue, notes), tap **+ Songs** and tap songs in performance order. **Edit** lets you drag to reorder, remove songs and add notes such as “Interval”. **▶ Start** steps through the whole concert: when you turn past the end of one score, the next one opens, and there are prev/next buttons too. Share or copy the song list, or duplicate a programme for next year.
- **Remove all scores**: Library › Remove all scores clears every score from the app (your folder is untouched). Programmes and categories are kept, and re-importing brings back each song's title, categories and place in programmes.
- **Backup**: Library › Download backup saves programmes, categories and titles (not the score files). Restore on a new phone, then import the folder again.

## Getting it onto your phone

The app is static files, so any static web host will do. The easiest is **GitHub Pages**, set up by the workflow in `.github/workflows/pages.yml`:

1. In the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. The workflow deploys on every push to `main`, or you can run it by hand from the **Actions** tab. The app's address is shown on the Settings → Pages screen (`https://<your-username>.github.io/<repository-name>/`).
3. Open that address in Chrome on your phone and tap ⋮, then **Install app** (or **Add to Home screen**). It appears on your home screen as **BFS**.
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
| `js/app.js` | Songs, categories, programmes, importing (folder and GitHub), backup |
| `js/viewer.js` | Full-screen viewer: zoom, page turning, programme navigation |
| `js/db.js` | IndexedDB storage for the score files and app data |
| `vendor/pdfjs/` | [PDF.js](https://mozilla.github.io/pdf.js/) 4.10.38 (Apache 2.0), stored here so it works offline |
| `sw.js` | Service worker for offline use |
| `manifest.webmanifest`, `icons/` | Installable-app metadata and icons |

If you change any files, bump `CACHE` in `sw.js` so installed copies pick up the update.
