# BFS Scores 🎼

A phone app for viewing and organising sheet music and building concert programmes.

It's an installable web app (PWA). It runs in your phone's browser, can be added to the home screen like a normal app and works offline. It needs no account and no app store, and your scores stay on your phone.

## Features

- **Import from your phone**: tap **Import scores** (or **Import from phone** in the Library tab) and pick the folder that holds your scores. PDFs and PNG/JPEG/WebP pictures are copied into the app's storage. Only the scores directly inside the chosen folder are imported; scores in its sub-folders are skipped (the app lists them). To add a sub-folder, tap **Import from phone** (Library tab) again and open that sub-folder in the picker. Its songs are marked with 📁 and the folder name. Tap **Import from phone** (Library tab) again after adding or changing scores: new files are added, changed ones updated, and your titles, categories and programmes are kept. If your phone only offers a file picker, open the folder and use ⋮ › **Select all**.
- **Download from GitHub**: tap **Download from GitHub** to download the scores in a folder of a GitHub repository (set up for `richardtoller/BFS`, folder `pdf`, branch `main`; change these in **Library › GitHub settings**). Only files directly in that folder are downloaded. Tap **Update from GitHub** after changing scores there: new files are added and changed ones downloaded again (unchanged ones are skipped), and your titles, categories and programmes are kept. Songs from GitHub are marked ☁ GitHub. You can use GitHub and your local folder together.
  - A **private repository needs an access token**. On GitHub, go to *Settings › Developer settings › Personal access tokens › Fine-grained tokens*, choose *Generate new token*, pick *Only select repositories* and your scores repository, and under *Permissions* set *Contents* to *Read-only*. Paste the token into **GitHub settings**. It is stored only in the app on your phone and is never included in backups.
- **Song names**: a new score's name comes from its file name, or for a score from photos from its printed title, with every word capitalised, so `the_lark_in_the_morn.pdf` becomes *The Lark In The Morn* and `heres_adieu….pdf` becomes *Here’s Adieu…*. Words that already have capitals are left as they are.
- **Edit a score's LilyPond source**: for a score downloaded from GitHub, tap ⋯ › **Edit LilyPond source**. The app opens `src/<name>.ly` (for `pdf/<name>.pdf`) in an editor.
  - **Preview** engraves the edit on the phone, in a second or two, with LilyPond 2.26.0 built into the app. It works offline. The PDF opens in the viewer, or LilyPond's errors are listed: tap one to jump to that line. The first preview downloads LilyPond (30 MB, once only; or use *Library › download it now*). The repository's include files and fonts are copied to the phone and kept up to date when online.
  - The scores repository builds its PDFs with the same LilyPond version, so the preview matches the published PDF. If previewing doesn't work on a phone, ⋯ › **Preview on GitHub instead** sends the edit to a temporary `preview/<name>` branch, where the repository's *Preview score* workflow engraves it (about a minute). `main` isn't touched.
  - **Publish** commits the `.ly` to `main` with your description of the change. The repository's *Build PDFs* workflow then rebuilds the PDFs, and the preview branch is deleted. If the file was changed on GitHub since you opened it, the app asks before replacing that change.
  - Unpublished edits are kept as drafts on the phone, marked *(draft)* in the ⋯ menu, until you publish or discard them.
  - Editing needs an access token with **Contents: Read and write** on the repository, and the repository needs `.github/workflows/preview-score.yml`.
- **Import and convert** (Library tab): photograph each page of a score, choose photos, or choose files from the phone or Google Drive (PDFs of the score, pictures, or MusicXML, ABC or LilyPond files; for Drive, tap ☰ in the file picker and choose **Drive**), and tap **Convert to LilyPond**. Compressed MusicXML (`.mxl`) needs exporting as `.musicxml` first; PDFs can be up to 20 MB. Claude (Anthropic's AI model, Claude Opus 5.5) reads them and writes a LilyPond file in the house style, using the repository's style file and an existing score as its guide. The app checks the file with its built-in LilyPond and, if there are errors, sends them back to Claude once to fix. The new score opens in the editor, with Claude's notes on anything uncertain and the photos or PDFs under ⋯ › **View the photos** / **View the originals**, for you to check and correct before publishing. Publishing adds `src/<name>.ly` to the repository; GitHub builds the PDF. Unpublished new scores are listed in the Library tab.
  - This needs your own Claude API key (**Claude API key** in the Library tab; create one at platform.claude.com › Settings › API keys, and add credit under Billing) as well as the GitHub settings with a read-and-write token. Each conversion is charged to your Anthropic account, typically well under $1 for a few pages. The key is stored only on the phone, sent only to Anthropic, and never included in backups.
  - Transcriptions of photos are rarely perfect: compare the result with the photos bar by bar. Flat pages, good light and the camera square-on give the best results.
- **Rename songs**: tap ⋯ beside a song and change its name. Only the name shown in the app changes: the song stays linked to its original file (shown underneath), so re-importing keeps your name, and searching still finds it by the file name. **Use the file name** puts the original name back.
- **Notes**: each score can have its own text notes (key, repeats, who sings which verse…). Add them with ⋯ beside a song, or with 📝 while viewing the score; a dot on 📝 shows a score has notes. The first line shows under the title in the song and programme lists, and search looks in notes too. Notes are included in backups.
- **Categories**: *Current* and *Christmas* to start with. Songs whose file names look Christmassy (Silent Night, Jingle Bells, carols and so on) go in Christmas automatically; everything else starts uncategorised. Fix any song with ⋯, or tap **Select** to change many at once. Filter the list with the category chips, or search by title. Add, rename or delete categories in the Library tab.
- **Viewer**: tap a title to open the score full screen. Pinch or double-tap to zoom (up to 500%, redrawn sharp at every zoom level) and drag to move around. Tap the right or left edge to go forward or back a screen, or tap the middle to show the controls. ↕/↔ switches between fit-to-width and whole-page view. Works in portrait and landscape, keeps the screen awake, and works with Bluetooth page-turner pedals (arrow and Page Up/Down keys).
- **Concert programmes**: create a programme (name, date, venue, notes), tap **+ Songs** and tap songs in performance order. **Edit** lets you drag to reorder, remove songs and add notes such as “Interval”. **▶ Start** steps through the whole concert: when you turn past the end of one score, the next one opens, and there are prev/next buttons too. Share or copy the song list, or duplicate a programme for next year.
- **Remove all scores**: Library › Remove all scores clears every score from the app (the original files on your phone or on GitHub are untouched). Programmes and categories are kept, and re-importing brings back each song's title, categories and place in programmes.
- **Backup**: Library › Download backup saves programmes, categories and titles (not the score files). Restore on a new phone, then import your scores or download them from GitHub again.

## Getting it onto your phone

The app is static files, so any static web host will do. The easiest is **GitHub Pages**, set up by the workflow in `.github/workflows/pages.yml`:

1. In the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. The workflow deploys on every push to `main`, or you can run it by hand from the **Actions** tab. The app's address is shown on the Settings → Pages screen (`https://<your-username>.github.io/<repository-name>/`).
3. Open that address in Chrome on your phone and tap ⋮, then **Install app** (or **Add to Home screen**). It appears on your home screen as **BFS**.
4. Open the app and import your scores, from a folder on the phone or from GitHub.

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
| `vendor/lilypond-wasm/` | [LilyPond 2.26.0 compiled to WebAssembly](https://github.com/sightread/lilypond-wasm) (GPL-3.0-or-later), for previewing edits. It is cached on the phone the first time it's used, separately from the app, so app updates don't download it again |
| `vendor/anthropic-sdk/` | The [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) 1.10.0 bundled for the browser, for Import and convert |
| `vendor/pdfjs/` | [PDF.js](https://mozilla.github.io/pdf.js/) 4.10.38 (Apache 2.0), stored here so it works offline |
| `sw.js` | Service worker for offline use |
| `manifest.webmanifest`, `icons/` | Installable-app metadata and icons |

If you change any files, bump `CACHE` in `sw.js` so installed copies pick up the update.
