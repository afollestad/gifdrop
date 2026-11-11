<p align="center">
  <picture>
    <source srcset="images/app-icon-dark.png" media="(prefers-color-scheme: dark)">
    <img src="images/app-icon-light.png" alt="" width="96" height="96">
  </picture>
</p>

<h1 align="center">GifDrop</h1>

<p align="center">Drop a video, get a GIF, right in your browser at <a href="https://gifdrop.af.codes">gifdrop.af.codes</a>.</p>

Trim, crop, and tune the size, speed and loop, with an estimated file size before you commit. Your video never leaves your device.

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
