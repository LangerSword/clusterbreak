# tools/browser — deployed-site verification suite

Scripted Playwright checks that run against the **deployed** app (or any URL you
pass). They launch system Chrome with software GL (SwiftShader) so WebGL pages
render in a headless environment, drive real flows, assert on the DOM, and fail
on any console error. See the `headless-webgl-verification` skill for the method.

```bash
node tools/browser/verify.mjs   [url]   # mount + WebGL + node labels + model switch recompute
node tools/browser/verify2.mjs  [url]   # link wiring (pipeline estimate) + node drag
node tools/browser/verify3.mjs  [url]   # run a rig, unplug a node (postmortem), throttle a link
node tools/browser/verify5.mjs  [url]   # measured vs unverified markers, fitted provenance
node tools/browser/verify6.mjs  [url]   # detect, custom device, rig import, HF model library
```

- `CHROME_PATH` overrides the Chrome binary (defaults to this machine's ms-playwright build).
- The default automation browser runs `--disable-gpu` (no WebGL) — that's why these
  scripts exist; the daemon browser would show a mounted canvas with no scene.
- Screenshots: `/tmp/cb-shot*.png`.
