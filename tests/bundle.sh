#!/bin/sh
# Classic-script bundle of extension/editor/*.js so the page opens from file:// in headless Chromium
set -e
R=$(dirname "$0")/../extension/editor
T=$(dirname "$0")/../unsynced/test
mkdir -p "$T"
O=$T/bundle.js
{
echo '(async () => {'
echo 'const S = (() => {'; sed 's/^export //' "$R/sdj.js"; echo 'return { W, H, BASE_COLORS, CANVAS_TOKEN, CANVAS_ENTRY, SIZES, LIMITS, STROKE_SCALE, r2, baseEntry, customToken, entryFor, isStandard, pathD, endTime, buildSdj, validate, timed, nearestWeight, hexToRgb, rgbToHex, nearestBase, snapColor, snapStroke, rdp, simplifyStrokes, cutStrokes }; })();'
echo 'const F = (() => { const { W, H, STROKE_SCALE, CANVAS_TOKEN, pathD } = S;'; sed '/^import /d;s/^export //' "$R/fill.js"; echo 'return { chainRows, rasterInk, floodRegion, hatchRegion }; })();'
echo 'const { photoToPolylines, textToPolylines, centerlines, clipToCanvas } = (() => { const { W, H, LIMITS, STROKE_SCALE, nearestBase, rdp } = S;'; sed '/^import /d;s/^export //' "$R/raster.js"; echo 'return { photoToPolylines, textToPolylines, centerlines, clipToCanvas }; })();'
echo 'const { importSvg } = (() => { const { W, H, CANVAS_TOKEN, BASE_COLORS, LIMITS, STROKE_SCALE, customToken, rgbToHex, nearestBase, rdp } = S; const { chainRows } = F;'; sed '/^import /d;s/^export //' "$R/import-svg.js"; echo 'return { importSvg }; })();'
echo 'const { handDrawn } = (() => { const { W, H, LIMITS, r2 } = S;'; sed '/^import /d;s/^export //' "$R/sketchy.js"; echo 'return { handDrawn }; })();'
echo 'const P = (() => { const { W, H, LIMITS, r2 } = S;'; sed '/^import /d;s/^export //' "$R/precision.js"; echo 'return { GRID_SPACINGS, loadSettings, saveSettings, snapAngle, squareCorner, constrainShape, snapToGrid, ropeRadius, minStepFor, follow, penMove, penEnd, renderGuides }; })();'
echo 'const { createSelector, compose, transformStroke, IDENTITY } = (() => {'; sed '/^import /d;s/^export //' "$R/select.js"; echo 'return { createSelector, compose, transformStroke, IDENTITY }; })();'
echo 'const L = (() => { const { endTime } = S;'; sed '/^import /d;s/^export //' "$R/layers.js"; echo 'return { MAX_LAYERS, NAME_MAX, BACKGROUND, initial, nextId, nextName, blocked, shownIds, editableIds, editable, visible, order, replaceEditable, flatten, add, update, move, remove, mergeDown, duplicate, pack, unpack }; })();'
echo 'const lib = (() => {'; sed 's/^export //' "$R/library.js"; echo 'return { listDrawings, saveDrawing, updateDrawing, removeDrawing, importDrawings, exportFile, loadWorking, saveWorking }; })();'
sed '/^import /d' "$R/main.js"
echo 'window.__doodler = { get strokes() { return strokes; }, get layers() { return layers; }, get active() { return active; }, importSvg, photoToPolylines, handDrawn, S };'
echo '})();'
} > "$O"
sed 's#<script type="module" src="main.js"></script>#<script src="bundle.js"></script>#;s#href="style.css"#href="../../extension/editor/style.css"#' "$R/index.html" > "$T/index.html"
sed 's#<html lang="en">#<html lang="en" class="slowly-css">#;s#<link rel="stylesheet" href="../../extension/editor/style.css">#<link rel="stylesheet" href="../slowly/css/main.css">&#' "$T/index.html" > "$T/index-slowly.html"
node --check "$O"
