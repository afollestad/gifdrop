# gifdrop.af.codes

A video-to-GIF site that does everything in the browser. `main` is the published site: GitHub Pages serves the repo root through Jekyll, so anything committed here can go live unless `_config.yml` excludes it. There's no build step. Preview with a local static server rather than opening the file directly, since module scripts and workers need one. Safari can keep using old files from a server that sends no cache headers, so have it send `Cache-Control: no-store`.

## Keep this file and the README up to date

After changing files, architecture, conventions or behavior, check whether this file or `README.md` needs updating.

## Commits

- Use the trailer `Co-authored-by: Claude <noreply@anthropic.com>`, or `Co-authored-by: Codex <noreply@openai.com>` for Codex.
- No conventional prefixes like `feat:`. Put ticks around code names, and keep bodies short.
- Run `/self-review-diff` before committing.

## Publishing

`_config.yml` names root files outright, because Jekyll's `**/*.md` doesn't match the repo root. `LICENSE.md` must never be published, while `vendor/gifenc/LICENSE.txt` must be, since the MIT license requires it, which is why that one isn't Markdown. When adding anything at the root that isn't part of the site, add it to `exclude`.

## Look and theming

- Colors come from the app icon's deep blue and cyan. The stylesheets are hand-written on the same base as af.codes and the app sites (`gh-pages` on Alveary, Chromahora and Carouline), so carry layout changes across from them rather than letting them drift.
- `styles/index-light.css` and `index-dark.css` hold the color tokens and the hero's glow, and `index-common.css` holds everything theme-independent. Both theme sheets ship on every load, media-scoped to `prefers-color-scheme`, so the page follows the OS with no JavaScript. `scripts/dark-mode.js` only steps in when the toggle stores an override. Keep its colors in step with each sheet's `--bg`, and with `index.html`'s `theme-color` metas.
- Text tokens hold at least 4.5:1 on `--bg` and on the glow's strongest point, and the title gradient holds 3:1. Re-check these when changing colors.

## Architecture

```
scripts/app/main.js          Page start: screen state, focus, file intake. Loads editor.js separately.
scripts/app/editor.js        Everything after a file is chosen, wiring the modules below
scripts/app/state.js         Pure reducer for which screen is showing
scripts/app/settings.js      Pure: what's chosen, and what it works out to
scripts/app/plan.js          Pure: frame times, delays and output size
scripts/app/limits.js        Pure: control options, presets, limits and warnings
scripts/app/crop-math.js     Pure: crop rectangles
scripts/app/format.js        Pure: times and sizes as people read and hear them
scripts/app/messages.js      Pure: what to say when things go wrong
scripts/app/file-check.js    Pure: whether a file could be a video
scripts/app/estimate-math.js Pure: predicting a GIF's size from a sample
scripts/app/seek-policy.js   Pure: deciding when a seek has landed
scripts/app/video-source.js  Loading a video until its frames can be captured
scripts/app/video-seeker.js  Seeking until the new frame is showing
scripts/app/frame-reader.js  Reading a frame as pixels
scripts/app/frame-grabber.js Seek plus read, waiting out hidden tabs
scripts/app/video-session.js One opened file, with its preview and capture elements
scripts/app/encoder-client.js The main thread's side of the worker, with backpressure
scripts/app/converter.js     Video and settings to GIF
scripts/app/estimator.js     Encoding a sample with the real pipeline
scripts/ui/                  One module per control, taking elements and callbacks
scripts/worker/encoder-*.js  The worker's message loop, and EncoderJob with no worker dependency
scripts/worker/palette.js    Global palette: histogram, variance-minimising split, k-means
scripts/worker/remap.js      Ordered dither and transparency
scripts/worker/gif-writer.js Writes through gifenc, merging repeats, and the boomerang's return
vendor/gifenc/               gifenc 1.0.3, unmodified
```

Keep browser-free logic in pure modules so Node can test it, one responsibility per module. Feature-detect rather than sniffing user agents, and give a missing API a tested fallback.

## Hard-won behavior

Each of these was measured, and the code's comments say why. Don't simplify them away without rerunning the capture suite in every browser.

- **Seeking:** `seeked` can come before the paint in Safari and iOS, and a frame callback may describe an older frame, so a capture waits for both, judged by `seek-policy.js`. Same-frame seeks get no callback in Safari, hence the fallback, and Chrome can repeat the old frame just before a new one, so that only shortens the wait.
- **iOS:** frame data is held back until a video has played, so `video-source.js` plays and pauses it. The first seek after that never paints, and repeating the position or seeking to 0 doesn't help, so a seek near the start is spent first. Low Power Mode refuses the play, which needs a tap.
- **Silent freezes:** a file cut off partway, or WebM with no seek index in Firefox, reports success and its full length as seekable while repeating an earlier frame. Only `canSeekNearEnd` notices. Playing it through first doesn't help Firefox.
- **`willReadFrequently`** stays off. It sounds right, but made reads of HDR video about 40 times slower in Chrome.
- **gifenc** needs `dispose: 1` on every frame, since transparency defaults to clearing the canvas, and a palette only on the first frame, since later ones would each write a local table.
- **Tests use object URLs**, as the app does, since browsers can load those differently from a server's.
- **Each session gets new `<video>` elements.** An earlier session's unfinished seek would otherwise land on the next video while it loads, which hung it on iOS.
- **Drops:** `dragenter` must be cancelled as well as `dragover`. WebKit goes by the last one it fired, and showing the overlay changes the target, so otherwise a quick drop navigates to the file. Synthetic events can't show this, since they skip the browser's decision.
- **Static video:** a jump inside one long frame gets no callback, so long seeks wait less after each miss (`presentFallbackMs`). The first is never shortened, since that's how a cut-off file looks.

## Testing

- `npm test` runs the unit tests with Node's runner.
- `npm run fixtures` generates videos into `tests/fixtures/`, which is ignored, using `ffmpeg`.
- `npm run test:e2e -- <browser> [suite]` runs the `capture`, `convert` and `ui` suites in `chrome`, `firefox`, `safari` or `ios` (or `ios=<udid>`). Set `CHROME_PATH` or `FIREFOX_PATH` for a specific binary. Barcode fixtures encode each frame's number, so a wrong frame fails by name. Safari's tab must stay visible, since capture pauses while hidden.
- `.github/workflows/ci.yml` runs all of it. macOS minutes cost 10x on a private repo.
- `tests/e2e/screenshots.mjs` captures every screen at each width and theme, using generated footage.
- `npm run test:footage -- <browser> <path>` tries a real video and leaves GIFs in `tests/e2e/out/`, which is ignored. Someone's own videos may be private, so read its numbers rather than opening frames, delete the output afterward, and never commit or upload any of it.

## Images

- `favicon.ico`, `favicon.png` and `apple-touch-icon.png` are as supplied.
- `images/app-icon.png` is the supplied 1254x1254 icon at 256x256, with its plate's edge redrawn as a superellipse (exponent 5), since the source's alpha has stray specks around it. Its edges were fitted at x 52-1202 and y 56-1199.
- `images/og-image.png` comes from `og-image/render.sh`. Re-render it when the icon, the name or the dark theme's colors change.

## Known limits

- Files the browser can't decode fail with an error, by design.
- One palette covers the whole GIF, a compromise on clips with very different scenes. Per-scene palettes would be the upgrade.
- About one in ten iOS Simulator runs on CI, a long first seek got no new-frame callback within its limit and captured an earlier frame, with no warning. The cause is unknown, and it hasn't been seen on a real iPhone. If the capture suite fails this way again, its `longMisses` report whether `seeked` arrived, whether callbacks came with old times or not at all, and whether the page was still rendering. A likely fix is to seek away and back after the first miss, which is what recovers from the iOS first-seek behavior above.
- Safari can decode the same frame slightly differently from one pass to the next, though always the right frame. The cause is unknown, and the only effect seen is an estimate differing by under 2%.
