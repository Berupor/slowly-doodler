import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSdj, validate, cutStrokes } from '../extension/editor/sdj.js';
import { lassoPick } from '../extension/editor/select.js';
import {
  MAX_LAYERS, initial, nextName, blocked, editable, visible, order, replaceEditable, flatten, add, update, move, remove, mergeDown, duplicate, pack, unpack,
} from '../extension/editor/layers.js';

const GAP = 400;
const line = (layer, x0, y0, x1, y1, startOffset = 0) => ({ color: 'black', weight: 3, startOffset, points: [[x0, y0, 0], [x1, y1, 100]], layer });

function twoLayers() {
  const first = initial();
  const second = add(first.layers, first.active, nextName(first.layers));
  const strokes = [line('l1', 100, 100, 300, 100, 0), line('l1', 100, 200, 300, 200, 500), line('l2', 100, 300, 300, 300, 200)];
  return { strokes: order(strokes, second.layers), layers: second.layers, active: second.active };
}

describe('add', () => {
  it('puts a named layer above the active one and makes it active', () => {
    const { layers, active } = initial();
    const top = add(layers, active, 'Layer 2');
    const mid = add(top.layers, active, 'photo');
    assert.deepEqual(mid.layers.map(l => l.name), ['Layer 1', 'photo', 'Layer 2']);
    assert.equal(mid.active, mid.layers[1].id);
    assert.equal(new Set(mid.layers.map(l => l.id)).size, 3);
  });

  it('names new layers after the highest number in use', () => {
    const { layers } = initial();
    assert.equal(nextName(layers), 'Layer 2');
    assert.equal(nextName([...layers, { id: 'l5', name: 'Layer 7', hidden: false, locked: false }]), 'Layer 8');
    assert.equal(nextName(initial('Background').layers), 'Layer 2');
  });
});

describe('blocked', () => {
  it('refuses new strokes on a hidden or locked layer and names it', () => {
    const { layers, active } = twoLayers();
    assert.equal(blocked(layers, active), null);
    assert.match(String(blocked(update(layers, active, { hidden: true }), active)), /"Layer 2" is hidden/);
    assert.match(String(blocked(update(layers, active, { locked: true }), active)), /"Layer 2" is locked/);
  });
});

describe('editable', () => {
  it('leaves out strokes on hidden and locked layers', () => {
    const { strokes, layers } = twoLayers();
    assert.deepEqual(editable(strokes, update(layers, 'l2', { hidden: true })), strokes.slice(0, 2));
    assert.deepEqual(editable(strokes, update(layers, 'l1', { locked: true })), strokes.slice(2));
    assert.deepEqual(visible(strokes, update(layers, 'l1', { locked: true })), strokes);
  });

  it('keeps a lasso on a hidden layer from picking its strokes', () => {
    const { strokes, layers } = twoLayers();
    const all = [[50, 50], [350, 50], [350, 350], [50, 350]];
    assert.equal(lassoPick(editable(strokes, layers), all).length, 3);
    assert.deepEqual(lassoPick(editable(strokes, update(layers, 'l1', { hidden: true })), all), strokes.slice(2));
  });

  it('lets a cut through every layer split only the editable strokes', () => {
    const { strokes, layers } = twoLayers();
    const locked = update(layers, 'l2', { locked: true });
    const part = editable(strokes, locked);
    const { strokes: cut } = cutStrokes(part, [200, 50], [200, 350], 10);
    const next = replaceEditable(strokes, locked, cut);
    assert.equal(next.length, 5);
    assert.deepEqual(next.slice(0, 4).map(s => s.layer), ['l1', 'l1', 'l1', 'l1']);
    assert.equal(next[4], strokes[2]);
  });
});

describe('order', () => {
  it('groups strokes bottom layer first and keeps their order inside a layer', () => {
    const { layers } = twoLayers();
    const a = line('l2', 0, 0, 1, 1), b = line('l1', 0, 0, 1, 1), c = line('l2', 0, 0, 2, 2), d = line('l1', 0, 0, 2, 2);
    assert.deepEqual(order([a, b, c, d], layers), [b, d, a, c]);
  });

  it('returns the same array when it is already in order', () => {
    const { strokes, layers } = twoLayers();
    assert.equal(order(strokes, layers), strokes);
  });
});

describe('flatten', () => {
  it('leaves a single layer as it is', () => {
    const { layers } = initial();
    const strokes = [line('l1', 0, 0, 10, 10, 0), line('l1', 0, 0, 20, 20, 300)];
    assert.deepEqual(flatten(strokes, layers, GAP), strokes);
  });

  it('plays layers bottom to top: an overlapping upper layer starts after the lower one ends', () => {
    const { strokes, layers } = twoLayers();
    const flat = flatten(strokes, layers, GAP);
    assert.deepEqual(flat.map(s => s.points[1][1]), [100, 200, 300]);
    assert.equal(flat[2].startOffset, 500 + 100 + GAP);
    assert.deepEqual(flat.map(s => s.points), strokes.map(s => s.points));
  });

  it('keeps an upper layer drawn later at its own time', () => {
    const { strokes, layers } = twoLayers();
    const late = strokes.map(s => (s.layer === 'l2' ? { ...s, startOffset: 5000 } : s));
    assert.equal(flatten(late, layers, GAP)[2].startOffset, 5000);
  });

  it('leaves hidden layers out and the result passes the limits check', () => {
    const { strokes, layers } = twoLayers();
    const flat = flatten(strokes, update(layers, 'l1', { hidden: true }), GAP);
    assert.deepEqual(flat, strokes.slice(2));
    assert.equal(validate(buildSdj(flat, {})), null);
    assert.ok(!('layer' in buildSdj(flat, {}).strokes[0]));
  });
});

describe('move', () => {
  it('swaps a layer with its neighbour and stops at the ends', () => {
    const { layers } = twoLayers();
    assert.deepEqual(move(layers, 'l1', 1).map(l => l.id), ['l2', 'l1']);
    assert.equal(move(layers, 'l1', -1), layers);
    assert.equal(move(layers, 'l2', 1), layers);
  });

  it('changes what is on top when flattened', () => {
    const { strokes, layers } = twoLayers();
    const moved = move(layers, 'l2', -1);
    assert.deepEqual(flatten(order(strokes, moved), moved, GAP).map(s => s.points[1][1]), [300, 100, 200]);
  });
});

describe('mergeDown', () => {
  it('moves the strokes onto the layer below, above what is there', () => {
    const { strokes, layers } = twoLayers();
    const m = /** @type {NonNullable<ReturnType<typeof mergeDown>>} */ (mergeDown(strokes, layers, 'l2'));
    assert.deepEqual(m.layers.map(l => l.id), ['l1']);
    assert.equal(m.active, 'l1');
    assert.deepEqual(m.strokes.map(s => [s.layer, s.points[1][1]]), [['l1', 100], ['l1', 200], ['l1', 300]]);
  });

  it('does nothing for the bottom layer', () => {
    const { strokes, layers } = twoLayers();
    assert.equal(mergeDown(strokes, layers, 'l1'), null);
  });
});

describe('remove and duplicate', () => {
  it('deletes a layer with its strokes and selects the one below', () => {
    const { strokes, layers } = twoLayers();
    const r = /** @type {NonNullable<ReturnType<typeof remove>>} */ (remove(strokes, layers, 'l2'));
    assert.deepEqual(r.strokes, strokes.slice(0, 2));
    assert.equal(r.active, 'l1');
    assert.equal(remove(r.strokes, r.layers, 'l1'), null);
  });

  it('copies a layer just above with copies of its strokes', () => {
    const { strokes, layers } = twoLayers();
    const d = duplicate(strokes, update(layers, 'l1', { locked: true }), 'l1');
    assert.deepEqual(d.layers.map(l => [l.name, l.locked]), [['Layer 1', true], ['Layer 1 copy', true], ['Layer 2', false]]);
    assert.equal(d.strokes.length, 5);
    assert.deepEqual(d.strokes.slice(2, 4).map(s => s.layer), [d.active, d.active]);
    assert.notEqual(d.strokes[2].points, strokes[0].points);
  });
});

describe('pack and unpack', () => {
  it('round-trips the layer structure next to the SDJ', () => {
    const { strokes, layers, active } = twoLayers();
    const hidden = update(layers, 'l1', { hidden: true, name: 'sketch' });
    const stored = JSON.parse(JSON.stringify({ sdj: buildSdj(strokes, {}), layers: pack(strokes, hidden, active) }));
    const back = unpack(stored.sdj.strokes, stored.layers);
    assert.deepEqual(back.layers, hidden);
    assert.equal(back.active, active);
    assert.deepEqual(back.strokes.map(s => s.layer), ['l1', 'l1', 'l2']);
  });

  it('loads an item without layers, or with a broken field, as one layer', () => {
    const sdj = buildSdj([line(undefined, 0, 0, 1, 1)], {});
    for (const packed of [undefined, null, { list: [], of: [] }, { list: [{ id: 'l1', name: 'a', hidden: false, locked: false }], of: [3] }]) {
      const back = unpack(sdj.strokes, packed);
      assert.deepEqual(back.layers.map(l => l.name), ['Layer 1']);
      assert.deepEqual(back.strokes.map(s => s.layer), [back.active]);
    }
  });

  it('refuses more than the layer cap', () => {
    const list = Array.from({ length: MAX_LAYERS + 1 }, (_, i) => ({ id: `l${i + 1}`, name: `Layer ${i + 1}`, hidden: false, locked: false }));
    assert.equal(unpack([], { list, active: 'l1', of: [] }).layers.length, 1);
  });
});
