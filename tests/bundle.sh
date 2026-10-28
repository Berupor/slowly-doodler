#!/bin/sh
# Classic-script bundle of extension/editor/*.js so the page opens from file:// in headless Chromium
set -e
R=$(dirname "$0")/../extension/editor
T=$(dirname "$0")/../unsynced/test
mkdir -p "$T"
O=$T/bundle.js
{
echo '(async () => {'
echo 'const S = (() => {'; sed 's/^export //' "$R/sdj.js"; echo 'return { W, H, BASE_COLORS, CANVAS_TOKEN, CANVAS_ENTRY, SIZES, LIMITS, STROKE_SCALE, r2, baseEntry, customToken, entryFor, isStandard, pathD, endTime, buildSdj, validate, timed, nearestWeight, hexToRgb, rgbToHex, nearestBase, rdp, simplifyStrokes }; })();'
echo 'const { importSvg } = (() => { const { W, H, CANVAS_TOKEN, BASE_COLORS, LIMITS, STROKE_SCALE, customToken, rgbToHex, nearestBase, nearestWeight } = S;'; sed '/^import /d;s/^export //' "$R/import-svg.js"; echo 'return { importSvg }; })();'
echo 'const { photoToPolylines, textToPolylines } = (() => { const { W, H, LIMITS, nearestBase, rdp } = S;'; sed '/^import /d;s/^export //' "$R/raster.js"; echo 'return { photoToPolylines, textToPolylines }; })();'
echo 'const P = (() => { const { W, H, LIMITS, r2 } = S;'; sed '/^import /d;s/^export //' "$R/precision.js"; echo 'return { GRID_SPACINGS, loadSettings, saveSettings, snapAngle, squareCorner, constrainShape, snapToGrid, ropeRadius, minStepFor, follow, penMove, penEnd, renderGuides }; })();'
echo 'const { createSelector } = (() => {'; sed '/^import /d;s/^export //' "$R/select.js"; echo 'return { createSelector }; })();'
echo 'const lib = (() => {'; sed 's/^export //' "$R/library.js"; echo 'return { listDrawings, saveDrawing, updateDrawing, removeDrawing, importDrawings, exportFile, loadWorking, saveWorking }; })();'
sed '/^import /d' "$R/main.js"
echo 'window.__doodler = { get strokes() { return strokes; }, importSvg, photoToPolylines, S };'
echo '})();'
} > "$O"
sed 's#<script type="module" src="main.js"></script>#<script src="bundle.js"></script>#;s#href="style.css"#href="../../extension/editor/style.css"#' "$R/index.html" > "$T/index.html"
sed 's#<html lang="en">#<html lang="en" class="slowly-css">#;s#<link rel="stylesheet" href="../../extension/editor/style.css">#<link rel="stylesheet" href="../slowly/css/main.css">&#' "$T/index.html" > "$T/index-slowly.html"
node --check "$O"
