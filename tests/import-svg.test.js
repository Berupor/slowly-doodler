import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hatch, trimHidden } from '../extension/editor/import-svg.js';

/** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
const rect = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];

/** @param {number[][][]} subpaths @param {boolean} hatched */
function layer(subpaths, hatched) {
  const lines = subpaths.map(pts => ({ kind: 'outline', pts }));
  if (hatched) lines.push(...hatch(subpaths, 5, Math.PI / 4).map(pts => ({ kind: 'hatch', pts })));
  return { subpaths, rule: 'nonzero', filled: true, lines };
}

const hatchOf = (/** @type {{ kind: string, pts: number[][] }[]} */ lines) => lines.filter(l => l.kind === 'hatch');
const points = (/** @type {{ pts: number[][] }[]} */ lines) => lines.flatMap(l => l.pts);

describe('trimHidden', () => {
  it('drops the hatch of a fill that is fully covered by a fill painted above it', () => {
    const under = layer(rect(200, 200, 400, 400), true);
    const over = layer(rect(150, 150, 450, 450), false);
    assert.ok(points(hatchOf(under.lines)).length > 10);
    const out = trimHidden([under, over]);
    assert.equal(hatchOf(out).length, 0);
    assert.deepEqual(out.map(l => l.pts), over.lines.map(l => l.pts), 'only the top outline is left');
  });

  it('hatches only the visible part of a partly covered fill', () => {
    const under = layer(rect(100, 100, 400, 400), true);
    const over = layer(rect(250, 50, 500, 450), false);
    const out = trimHidden([under, over]);
    const shown = points(hatchOf(out));
    assert.ok(shown.length > 10);
    for (const [x] of shown) assert.ok(x <= 251, `hatch at x ${x} runs under the top fill`);
    assert.ok(Math.max(...shown.map(p => p[0])) > 245, 'the hatch reaches the edge of the top fill');
    assert.ok(Math.min(...shown.map(p => p[0])) < 105, 'the uncovered part keeps its hatch');
    const outline = points(out.filter(l => l.kind === 'outline' && l !== over.lines[0]));
    for (const [x] of outline.filter(p => p[0] < 250)) assert.ok(x >= 99);
    assert.ok(!outline.some(([x, y]) => x > 252 && x < 400 && (y === 100 || y === 400)), 'the covered part of the outline is gone');
  });

  it('keeps everything when the shape above is not filled', () => {
    const under = layer(rect(100, 100, 400, 400), true);
    const over = { ...layer(rect(150, 150, 450, 450), false), filled: false };
    assert.equal(hatchOf(trimHidden([under, over])).length, hatchOf(under.lines).length);
  });

  it('lets a hole cut by the even-odd rule show what is under it', () => {
    const under = layer(rect(100, 100, 400, 400), true);
    const ring = { ...layer([...rect(50, 50, 450, 450), ...rect(200, 200, 300, 300)], false), rule: 'evenodd' };
    const shown = points(hatchOf(trimHidden([under, ring])));
    assert.ok(shown.length > 0);
    for (const [x, y] of shown) assert.ok(x >= 199 && x <= 301 && y >= 199 && y <= 301, `${x} ${y} is outside the hole`);
  });
});
