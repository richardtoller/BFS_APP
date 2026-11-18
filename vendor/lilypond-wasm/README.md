# LilyPond engine (WebAssembly)

LilyPond 2.26.0 compiled to WebAssembly, from the npm package
[@sightread/lilypond-wasm](https://github.com/sightread/lilypond-wasm) 0.2.0.
The app uses it to engrave previews of edited scores on the phone.

- `src/`: the package's browser entry point and worker (its Node-only `worker-node.mjs` is left out).
- `dist/`: the engine itself. SHA-256 checksums are pinned in `src/dist-files.mjs`.

Licences: GPL-3.0-or-later for LilyPond and the package (see `LICENSE`), and those in `licenses/`
and `dist/THIRD-PARTY-NOTICES.txt` for the bundled libraries and fonts. Source code:
the package's repository above, and LilyPond at https://gitlab.com/lilypond/lilypond (tag v2.26.0).

To update it, replace these files with the same ones from a newer package version, change
`ENGINE_CACHE` in `sw.js`, and install the matching LilyPond version in the scores
repository's workflows so previews keep matching the published PDFs.
