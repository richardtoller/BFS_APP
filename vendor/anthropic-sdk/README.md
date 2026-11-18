# Anthropic SDK (browser bundle)

The official TypeScript/JavaScript SDK, [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript)
1.10.0 (Apache-2.0, see `LICENSE`; earlier MIT-licensed parts: `LICENSE-MIT`), bundled into one ES module for the browser so the app needs no build step.
The app uses it to send photos of scores to Claude for "New score from photos".

Rebuild with:

```sh
npm install @anthropic-ai/sdk esbuild
echo 'export { default, Anthropic } from "@anthropic-ai/sdk";' > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --platform=browser --minify --legal-comments=eof --outfile=anthropic-sdk.mjs
```
