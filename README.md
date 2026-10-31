# GifDrop

Drop a video, get a GIF, at [gifdrop.af.codes](https://gifdrop.af.codes). Trim, crop, and tune the size, speed and loop, with an estimated file size before you commit. It all runs in your browser, so your video is never uploaded.

It opens whatever your browser can play, which usually means MP4, WebM and MOV.

## Development

There's no build step. Serve the repo root with any static server:

```sh
python3 -m http.server
```

Tests need Node, and the browser tests also need `ffmpeg` to generate their videos:

```sh
npm test                        # Unit tests
npm run fixtures                # Generates the test videos
npm run test:e2e -- chrome      # Browser tests: chrome, firefox, safari or ios
npm run test:footage -- chrome ~/clip.mov   # Tries your own video, which stays on your machine
```

## License

[GPL-3.0](LICENSE.md). Includes [gifenc](https://github.com/mattdesl/gifenc), under the MIT license.
