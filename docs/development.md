# Development

```
pnpm install
pnpm check        # eslint, tsc, node --test
pnpm test:e2e     # playwright
pnpm shots        # regenerate docs/ images: playwright, Pillow, ffmpeg
```

The e2e (`tests/test.py`) drives the editor in headless Chromium and checks every export against Slowly's own validator, which is not in the repo: put the `Wz` function from their `main.*.js` into `unsynced/test/wz.js`. For the `slowly` variant and `pnpm shots`, also copy their `main.css` to `unsynced/slowly/css/`. Needs Python with `playwright` and its Chromium.
