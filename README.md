# slowly-doodler

Chrome extension for web.slowly.app. It replaces the drawing editor in the letter composer with a bigger one and hands the result back to Slowly's own editor, so the letter goes out as a normal Slowly drawing. Unofficial, not affiliated with Slowly. Slowly's terms (section 1) forbid third-party applications that interact with the service without their written consent, and I have none; use it at your own risk, accounts can be suspended.

Besides drawing by hand (symmetry brushes, tracing reference, layers, fill, lasso), it turns an SVG, a photo or text into pen strokes. Every import ends up as ordinary strokes with a timeline.

![Remix a received drawing, draw over it, send](docs/flow.gif)

![An image next to its line art](docs/photo.png)

![SVG imported and replayed stroke by stroke](docs/scene.gif)

![Kaleido 12 symmetry with rainbow strokes](docs/draw.gif)

## Install

No store listing, so it loads unpacked.

1. Get the code: on [GitHub](https://github.com/Berupor/slowly-doodler) click Code > Download ZIP and unzip it, or `git clone https://github.com/Berupor/slowly-doodler.git`.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click Load unpacked and pick the `extension/` folder inside the project.
4. Open web.slowly.app and start a letter.

To update, download or `git pull` again and press the reload icon on the extension's card. Keep the folder where it is, Chrome reads it from there. `pnpm zip` builds `slowly-doodler.zip` from the same folder.

## Use

- Click the drawing button in the composer, or the edit button on an attached drawing. Shift-click opens Slowly's own editor.
- Hover a received drawing: Remix opens it in Doodler, Save puts it in the library.

  ![Save and Remix over a received drawing](docs/hover.png)

- Send (the check mark) closes Doodler and attaches the drawing to the letter. Esc closes without sending.

  ![A drawing attached to the reply](docs/attached.png)

- `+` Insert takes a photo, SVG, text or reference image. The import lands as a preview you can move, resize and restyle (Outline, Sketch, Detailed, Ink scan), then Done adds it on a new layer. A reference image is for tracing and never sent; its opacity, scale and position live in a Reference row at the bottom of Layers.
- Layers (up to 10) exist only in the editor and the library; Send flattens the visible ones.
- The half-filled circle in the top bar previews the drawing in the other theme, also inside Slowly; it never changes what is sent. The `...` menu has the friend picker, shortcuts and an Advanced block with the raw sdj. Hold or right-click Replay for its speed; Clear sits at the bottom of the left strip.
- Keys: B pen, L line, O ellipse, E eraser, F fill, S select, `[` `]` weight, Shift+F full screen.

![Gallery in the dark theme](docs/library.png)

## What breaks

The send path depends on Slowly's markup and bundle. When something is missing, the extension shows a toast once per session, and More > Advanced still gives you the sdj to copy.

## More

- [How it works](docs/how-it-works.md): the restore-draft hook, permissions, what to fix when Slowly changes.
- [Development](docs/development.md): checks, e2e, regenerating the screenshots.

## License

MIT.

Screenshots use `docs/art/girl-and-cat.jpg`, an illustration generated with Qwen-Image for this repo.
