# slowly-doodler

Chrome extension for web.slowly.app. It replaces the drawing editor in the letter composer with a bigger one and hands the result back to Slowly's own editor, so the letter goes out as a normal Slowly drawing. Unofficial, not affiliated with Slowly.

Besides drawing by hand (symmetry brushes, tracing reference, layers, fill, lasso), it turns an SVG, a photo or text into pen strokes. Every import ends up as ordinary strokes with a timeline, so the recipient's replay looks hand drawn.

![Remix a received drawing, draw over it, send](docs/flow.gif)

![An image next to its line art](docs/photo.png)

![SVG imported and replayed stroke by stroke](docs/scene.gif)

![Kaleido 12 symmetry with rainbow strokes](docs/draw.gif)

## Install

No store listing. `chrome://extensions`, Developer mode, Load unpacked, pick `extension/`. `pnpm zip` builds `slowly-doodler.zip` from the same folder.

## Use

- Click the drawing button in the composer, or the edit button on an attached drawing. Shift-click opens Slowly's own editor.
- Hover a received drawing: Remix opens it in Doodler, Save puts it in the library.

  ![Save and Remix over a received drawing](docs/hover.png)

- Send (the check mark) closes Doodler and attaches the drawing to the letter. Esc closes without sending.

  ![A drawing attached to the reply](docs/attached.png)

- `+` Insert takes a photo, SVG, text or reference image. The import lands as a preview you can move, resize and restyle (Outline, Sketch, Detailed, Ink scan), then Done adds it on a new layer. A reference image is for tracing and never sent; its opacity, scale and position live in a Reference row at the bottom of Layers.
- Layers (up to 10) exist only in the editor and the library; Send flattens the visible ones.
- The `...` menu has the friend picker, dark theme, shortcuts and an Advanced block with the raw sdj. Hold or right-click Replay for its speed; Clear sits at the bottom of the left strip.
- Keys: B pen, L line, O ellipse, E eraser, F fill, S select, `[` `]` weight, Shift+F full screen.

![Gallery in the dark theme](docs/library.png)

Weights other than 1, 3, 6 and colors outside the 12 base ones are marked "experimental": they pass Slowly's validation but have not been checked in the mobile apps, and the colour popover says so while a custom colour is selected.

## How it works

`content/hook.js` runs in the page's JS world at document start and patches `Storage.prototype.getItem`. Slowly's editor offers to restore a draft from `slowly-drawing-recovery:*`; when Doodler has a drawing under `doodler:pending`, the patched `getItem` returns it for that key once. The content script then clicks Restore and Done like a user would. No request to Slowly is forged, the page does its own upload.

`editor/sdj.js` mirrors Slowly's drawing format and limits. `content/friends.js` recomputes Slowly's friend URL hashes to preselect the friend whose letter is open. The editor runs in an extension iframe with Slowly's stylesheets passed in. The library lives in extension storage.

Permissions are `storage` and `unlimitedStorage`, host access is `https://web.slowly.app/*` only. The only other request is the Open Sans stylesheet from Google Fonts.

## What breaks

The send path depends on Slowly's markup and bundle. The selectors are in one object, `SLOWLY` in `content/content.js`. When one is missing, the extension logs `doodler_selector_missing` and shows a toast once per session. More > Advanced still gives you the sdj to copy. If Slowly changes the drawing format, `editor/sdj.js` and the validator copy used by the e2e test need to follow.

## Development

```
pnpm install
pnpm check        # eslint, tsc, node --test
pnpm test:e2e     # playwright
pnpm shots        # regenerate docs/ images: playwright, Pillow, ffmpeg
```

The e2e (`tests/test.py`) drives the editor in headless Chromium and checks every export against Slowly's own validator, which is not in the repo: put the `Wz` function from their `main.*.js` into `unsynced/test/wz.js`. For the `slowly` variant and `pnpm shots`, also copy their `main.css` to `unsynced/slowly/css/`. Needs Python with `playwright` and its Chromium.

## License

MIT. The screenshots use `docs/art/kawaii-cat.svg`, the "kawaii cat" by amaziing.ai from freesvg.org, published there as public domain (CC0).
