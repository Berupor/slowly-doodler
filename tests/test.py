import base64, json, pathlib, sys
from playwright.sync_api import sync_playwright

OUT = pathlib.Path(__file__).parent.parent / 'unsynced' / 'test'
WITH_SLOWLY_CSS = 'slowly' in sys.argv[1:]
PAGE = 'index-slowly.html' if WITH_SLOWLY_CSS else 'index.html'
SUFFIX = '-slowly' if WITH_SLOWLY_CSS else ''
WZ = (OUT / 'wz.js').read_text()
SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
<rect x="10" y="10" width="80" height="60" fill="#e53935"/>
<circle cx="140" cy="60" r="40" fill="none" stroke="#1e88e5" stroke-width="4"/>
<path d="M20 150 Q 100 100 180 150 M20 180 L180 180" stroke="#43a047" stroke-width="2" fill="none"/>
<polygon points="100,120 130,190 70,190" fill="#7e57c2" stroke="#222" stroke-width="1"/>
</svg>'''
(OUT / 'shapes.svg').write_text(SVG)

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1400, 'height': 1000})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    page.on('requestfailed', lambda r: errors.append(r.url[:120]))
    page.goto((OUT / PAGE).as_uri())
    page.wait_for_timeout(300)

    def validate():
        return page.evaluate('''(wz) => { eval(wz); const j = JSON.parse(document.getElementById('out').value);
          try { Wz(j.sdj); return {ok: true, strokes: j.sdj.strokes.length, palette: Object.keys(j.sdj.palette)}; }
          catch (e) { return {ok: false, err: e.message}; } }''', WZ)

    box = page.locator('#board').bounding_box()
    def drag(pts):
        page.mouse.move(box['x'] + pts[0][0], box['y'] + pts[0][1])
        page.mouse.down()
        for x, y in pts[1:]:
            page.mouse.move(box['x'] + x, box['y'] + y, steps=4)
        page.mouse.up()

    drag([(60, 60), (120, 90), (180, 60), (240, 120)])
    page.keyboard.press('l'); drag([(60, 200), (300, 260)])
    page.keyboard.press('o'); drag([(80, 300), (200, 380)])
    page.keyboard.press('b')
    page.locator('#symmetry').select_option(label='Kaleido 12')
    page.locator('#rainbow').check(force=True)
    drag([(box['width'] / 2 + 20, box['height'] / 2), (box['width'] / 2 + 80, box['height'] / 2 + 40), (box['width'] / 2 + 120, box['height'] / 2 - 30)])
    page.locator('#rainbow').uncheck(force=True)
    page.locator('#symmetry').select_option('off')
    print('after drawing', validate())
    n = page.evaluate('__doodler.strokes.length')
    page.keyboard.press('e'); drag([(60, 60), (120, 90)]); page.keyboard.press('b')
    print('erased', n, '->', page.evaluate('__doodler.strokes.length'))
    page.keyboard.press('Control+z'); print('undo ->', page.evaluate('__doodler.strokes.length'))
    page.keyboard.press('Control+Shift+z'); print('redo ->', page.evaluate('__doodler.strokes.length'))
    page.screenshot(path=str(OUT / f'1-draw{SUFFIX}.png'))

    page.locator('#clear').click()
    page.locator('[data-tab=import]').click()
    page.locator('#svgFile').set_input_files(str(OUT / 'shapes.svg'))
    page.wait_for_timeout(300)
    print('svg hatch', validate(), page.locator('#status').inner_text())
    page.locator('#svgColors').select_option('exact')
    page.wait_for_timeout(400)
    print('svg exact', validate(), page.locator('#status').inner_text())
    page.screenshot(path=str(OUT / f'2-svg{SUFFIX}.png'))

    png = page.evaluate('''() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300);
      x.fillStyle = '#e53935'; x.beginPath(); x.arc(120, 150, 80, 0, 7); x.fill();
      x.fillStyle = '#1e88e5'; x.fillRect(230, 60, 120, 180); x.font = 'bold 60px sans-serif'; x.fillStyle = '#222'; x.fillText('Hi', 160, 280);
      return c.toDataURL('image/png').split(',')[1]; }''')
    (OUT / 'photo.png').write_bytes(base64.b64decode(png))
    page.locator('#clear').click()
    page.locator('#photoFile').set_input_files(str(OUT / 'photo.png'))
    page.wait_for_timeout(1500)
    print('photo', validate(), page.locator('#status').inner_text())
    page.locator('#photoColors').check(force=True)
    page.wait_for_timeout(1200)
    print('photo colours', validate(), page.locator('#status').inner_text())
    page.screenshot(path=str(OUT / f'3-photo{SUFFIX}.png'))

    def photo_extent():
        pts = [p for s in json.loads(page.locator('#out').input_value())['sdj']['strokes'] for p in s['points']]
        return [min(p[0] for p in pts), max(p[0] for p in pts), min(p[1] for p in pts), max(p[1] for p in pts)]
    def set_range(id, value):
        page.evaluate('([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input")); }', [id, value])
    fit = photo_extent()
    set_range('photoZoom', '3')
    page.wait_for_timeout(1500)
    print('photo zoom', validate(), photo_extent())
    set_range('photoPanX', '1')
    page.wait_for_timeout(1500)
    print('photo zoom pan', validate(), photo_extent())
    assert fit[3] - fit[2] < photo_extent()[3] - photo_extent()[2], 'zoom should enlarge the drawing'
    page.screenshot(path=str(OUT / f'3-photo-zoom{SUFFIX}.png'))
    set_range('photoZoom', '1')
    set_range('photoPanX', '0')
    page.wait_for_timeout(1500)

    page.locator('#clear').click()
    page.locator('#text').fill('Hello from far away, dear friend!')
    page.locator('#writeText').click()
    page.wait_for_timeout(800)
    print('text', validate(), page.locator('#status').inner_text())
    page.screenshot(path=str(OUT / f'4-text{SUFFIX}.png'))

    page.locator('[data-tab=draw]').click()
    page.locator('#replaySpeed').select_option('8')
    page.locator('#replay').click()
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / f'5-replay-mid{SUFFIX}.png'))
    page.wait_for_timeout(8000)
    print('replay button', page.locator('#replay i').get_attribute('data-glyph'))

    page.locator('[data-tab=library]').click()
    page.locator('#libName').fill('greeting')
    page.locator('#libSave').click()
    page.wait_for_timeout(300)
    print('library cards', page.locator('#libList .card').count())
    page.locator('[data-tab=draw]').click()
    page.locator('#dark').check(force=True)
    page.locator('[data-tab=library]').click()
    page.screenshot(path=str(OUT / f'6-library-dark{SUFFIX}.png'))
    page.locator('[data-tab=draw]').click()
    page.screenshot(path=str(OUT / f'7-draw-dark{SUFFIX}.png'))

    page.reload(); page.wait_for_timeout(500)
    print('restored after reload', page.evaluate('__doodler.strokes.length'))

    print('remix', page.evaluate('''async () => {
      const sdj = {version: 1, canvas: {width: 720, height: 960}, palette: {black: {light: '#222222', dark: '#F5F5F5'}, canvas: {light: '#ffffff', dark: '#2a2f39'}},
        strokes: [{color: 'black', weight: 3, startOffset: 0, points: [[100, 100, 0], [200, 150, 50], [300, 100, 90]]},
                  {color: 'canvas', weight: 6, startOffset: 200, points: [[150, 120, 0], [250, 120, 40]]}]};
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 960"><rect width="720" height="960" fill="#2a2f39"/>` +
        sdj.strokes.map(s => `<path d="${__doodler.S.pathD(s.points)}" stroke="${s.color === 'black' ? '#F5F5F5' : '#2a2f39'}" stroke-width="${2 * s.weight}" fill="none"/>`).join('') + '</svg>';
      const cropped = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="300" viewBox="0 0 720 300"><rect x="0" y="0" width="720" height="300" fill="#ffffff" /><g transform="translate(0,-50)">` +
        `<path d="${__doodler.S.pathD(sdj.strokes[0].points)}" stroke="#222222" stroke-width="6" fill="none"/></g></svg>`;
      const out = [await __doodler.importSvg(svg, {remix: true}), await __doodler.importSvg(cropped, {remix: true})];
      return out.map(r => r.polylines.map(p => [p.color, p.weight, p.pts[0].map(Math.round), p.pts[p.pts.length - 1].map(Math.round)]));
    }'''))
    page.locator('#rainbow').check(force=True)
    drag([(100, 500), (200, 520), (300, 480), (400, 540)])
    print('rainbow colours', page.evaluate('[...new Set(__doodler.strokes.slice(-8).map(s => s.color))]'))

    import math
    checks = []
    def check(name, ok, detail=''):
        checks.append(ok)
        print('PRECISION', 'ok  ' if ok else 'FAIL', name, detail)
    last = lambda: page.evaluate('__doodler.strokes[__doodler.strokes.length - 1]')
    near = lambda a, b, eps=0.6: abs(a - b) <= eps
    k = 720 / box['width']
    def setting(sel, value):
        page.evaluate('([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event("input", {bubbles: true})); el.dispatchEvent(new Event("change", {bubbles: true})); }', [sel, str(value)])
    page.locator('#rainbow').uncheck(force=True)
    page.locator('#clear').click()
    setting('#smoothing', 0)
    page.mouse.move(0, 0)

    page.keyboard.press('l')
    page.keyboard.down('Shift')
    drag([(100, 300), (300, 310)])
    s = last()['points']
    check('shift line: near-horizontal drag becomes horizontal', near(s[0][1], s[-1][1]), s)
    drag([(100, 350), (260, 480)])
    s = last()['points']
    ang = math.degrees(math.atan2(s[-1][1] - s[0][1], s[-1][0] - s[0][0]))
    check('shift line: 39 degrees snaps to 45', near(ang, 45, 0.1), ang)
    drag([(300, 100), (310, 360)])
    s = last()['points']
    check('shift line: near-vertical drag becomes vertical', near(s[0][0], s[-1][0]), s)
    page.keyboard.up('Shift')
    drag([(100, 300), (300, 310)])
    s = last()['points']
    check('line without shift keeps the free angle', not near(s[0][1], s[-1][1], 1), s)

    page.keyboard.press('o')
    page.keyboard.down('Shift')
    drag([(100, 500), (250, 560)])
    xs = [p[0] for p in last()['points']]; ys = [p[1] for p in last()['points']]
    check('shift ellipse is a circle', near(max(xs) - min(xs), max(ys) - min(ys), 0.1), (max(xs) - min(xs), max(ys) - min(ys)))
    drag([(450, 560), (350, 460)])
    xs = [p[0] for p in last()['points']]; ys = [p[1] for p in last()['points']]
    check('shift ellipse dragged up-left stays a circle', near(max(xs) - min(xs), max(ys) - min(ys), 0.1) and max(xs) - min(xs) > 100)
    page.keyboard.up('Shift')

    page.keyboard.press('b')
    page.keyboard.down('Shift')
    drag([(100, 600), (160, 640), (220, 610), (300, 640)])
    s = last()['points']
    check('shift pen: straight line from the start to the pointer', len(s) == 2 and near(s[0][0], 100 * k) and near(s[0][1], 600 * k) and near(s[1][0], 300 * k) and near(s[1][1], 640 * k), s)
    page.keyboard.up('Shift')

    page.locator('#clear').click()
    page.locator('#weight').evaluate('el => { el.value = 6; el.dispatchEvent(new Event("input", {bubbles: true})); }')
    page.locator('[title=red]').click()
    drag([(100, 100), (300, 100)])
    page.locator('#weight').evaluate('el => { el.value = 1; el.dispatchEvent(new Event("input", {bubbles: true})); }')
    page.locator('[title=blue]').click()
    drag([(100, 200), (300, 200)])
    page.locator('[title=black]').click()
    page.keyboard.down('Alt')
    page.mouse.click(box['x'] + 200, box['y'] + 100)
    page.keyboard.up('Alt')
    n = page.evaluate('__doodler.strokes.length')
    drag([(100, 400), (200, 400)])
    s = last()
    check('alt+click picks colour and weight', n == 2 and s['color'] == 'red' and s['weight'] == 6, (n, s['color'], s['weight']))
    page.keyboard.press('i')
    page.mouse.click(box['x'] + 200, box['y'] + 200)
    drag([(100, 450), (200, 450)])
    s = last()
    check('I then click picks the blue stroke', s['color'] == 'blue' and s['weight'] == 1, (s['color'], s['weight']))
    page.keyboard.press('i')
    page.mouse.click(box['x'] + 300, box['y'] + 700)
    check('I then click on empty canvas draws nothing', page.evaluate('__doodler.strokes.length') == 4)
    page.keyboard.press('e')
    page.keyboard.down('Alt')
    page.mouse.click(box['x'] + 200, box['y'] + 100)
    page.keyboard.up('Alt')
    page.keyboard.press('b')
    drag([(100, 500), (200, 500)])
    check('alt+click works from the eraser too and does not erase', page.evaluate('__doodler.strokes.length') == 5 and last()['color'] == 'red')

    swatches = page.locator('#colors button').count()
    page.locator('[data-tab=json]').click()
    page.locator('#out').fill('{"sdj": {"version": 1, "canvas": {"width": 720, "height": 960}, "palette": {}, "strokes": [{"color": "cff00ff", "weight": 3, "startOffset": 0, "points": [[100, 700, 0], [300, 700, 80]]}]}}')
    page.locator('#load').click()
    page.locator('[data-tab=draw]').click()
    page.locator('[title=black]').click()
    after_load = page.locator('#colors button').count()
    page.keyboard.down('Alt')
    page.mouse.click(box['x'] + 200 / k, box['y'] + 700 / k)
    page.keyboard.up('Alt')
    check('picked colour missing from the palette bar is added', page.locator('#colors button').count() == after_load + (0 if after_load > swatches else 1), (swatches, after_load, page.locator('#colors button').count()))

    page.locator('#clear').click()
    page.locator('[title=black]').click()
    page.keyboard.press('g')
    check('G shows the grid', page.evaluate('document.querySelectorAll("#guides path").length') == 3 and page.locator('#gridOn').is_checked())
    check('guides sit between ref and ink', page.evaluate('[...document.querySelector("#board").children].map(e => e.id).join()') == 'ref,guides,ink,live')
    check('guides use non-scaling hairlines', page.evaluate('[...document.querySelectorAll("#guides path")].every(p => getComputedStyle(p).vectorEffect === "non-scaling-stroke")'))
    check('grid is not in the exported SDJ', 'guides' not in page.locator('#out').input_value() and '"canvas"' in page.locator('#out').input_value())
    page.screenshot(path=str(OUT / f'8-grid{SUFFIX}.png'))
    page.keyboard.press('g')
    check('G hides the grid', page.evaluate('document.querySelectorAll("#guides path").length') == 0)

    page.keyboard.press('g')
    page.locator('#snapOn').check(force=True)
    setting('#gridSpacing', 48)
    on_grid = lambda v, step=48: near(round(v / step) * step, v, 0.01)
    page.keyboard.press('l')
    drag([(103, 207), (298, 311)])
    s = last()['points']
    check('snap: line ends land on grid crossings', all(on_grid(v) for p in (s[0], s[-1]) for v in p[:2]), s)
    page.keyboard.press('o')
    drag([(103, 407), (298, 511)])
    xs = [p[0] for p in last()['points']]; ys = [p[1] for p in last()['points']]
    check('snap: ellipse box lands on the grid', all(on_grid(v) for v in (min(xs), max(xs), min(ys), max(ys))), (min(xs), max(xs), min(ys), max(ys)))
    page.keyboard.press('b')
    drag([(103, 607), (150, 650), (210, 640), (251, 700)])
    s = last()['points']
    check('snap: pen starts on a crossing, later points are free', all(on_grid(v) for v in s[0][:2]) and not all(on_grid(v) for p in s[1:] for v in p[:2]), s[:3])
    page.keyboard.press('l')
    page.keyboard.down('Shift')
    drag([(103, 207), (298, 241)])
    s = last()['points']
    rem = math.degrees(math.atan2(s[1][1] - s[0][1], s[1][0] - s[0][0])) % 15
    check('snap + shift line: start on the grid, angle on a 15 degree step', all(on_grid(v) for v in s[0][:2]) and min(rem, 15 - rem) < 0.1, (s, rem))
    page.keyboard.up('Shift')

    page.locator('#clear').click()
    page.keyboard.press('Control+0')
    for _ in range(4):
        page.keyboard.press('+')
    check('zoomed in', page.locator('#zoom').inner_text() != '100%', page.locator('#zoom').inner_text())
    page.keyboard.press('l')
    drag([(150, 200), (420, 380)])
    s = last()['points']
    check('snap works zoomed', all(on_grid(v) for p in (s[0], s[-1]) for v in p[:2]), s)
    page.screenshot(path=str(OUT / f'9-grid-zoom{SUFFIX}.png'))
    page.keyboard.press('0')
    page.locator('#dark').check(force=True)
    page.keyboard.press('b')
    drag([(100, 700), (200, 640), (300, 700)])
    page.screenshot(path=str(OUT / f'10-grid-dark{SUFFIX}.png'))
    page.locator('#dark').uncheck(force=True)

    page.reload(); page.wait_for_timeout(500)
    check('grid, snap and spacing persist', page.locator('#gridOn').is_checked() and page.locator('#snapOn').is_checked() and page.locator('#gridSpacing').input_value() == '48')
    page.keyboard.press('g')
    page.locator('#snapOn').uncheck(force=True)
    page.locator('#clear').click()
    page.keyboard.press('b')

    def zigzag(smoothing, symmetric=False):
        setting('#smoothing', smoothing)
        page.locator('#clear').click()
        page.mouse.move(box['x'] + 60, box['y'] + 300)
        page.mouse.down()
        for i in range(1, 160):
            page.mouse.move(box['x'] + 60 + i * 2, box['y'] + 300 + (4 if i % 2 else -4))
        page.mouse.move(box['x'] + 380, box['y'] + 300)
        page.mouse.up()
        return last()['points']
    raw = zigzag(0)
    smooth = zigzag(60)
    spread = lambda pts: max(p[1] for p in pts[5:-1]) - min(p[1] for p in pts[5:-1])
    check('smoothing damps a zig-zag', spread(smooth) < spread(raw) / 3, (spread(raw), spread(smooth)))
    check('smoothing keeps fewer points', len(smooth) < len(raw) / 2, (len(raw), len(smooth)))
    end_x, end_y = 380 * k, 300 * k
    check('smoothed stroke ends at the lift point', near(smooth[-1][0], end_x) and near(smooth[-1][1], end_y), (smooth[-1], end_x, end_y))
    check('smoothed stroke keeps real, increasing times', smooth[-1][2] > 0 and all(b2[2] >= a2[2] for a2, b2 in zip(smooth, smooth[1:])), smooth[-1][2])
    page.screenshot(path=str(OUT / f'11-smoothing{SUFFIX}.png'))
    setting('#smoothing', 60)
    page.locator('#symmetry').select_option(label='Mirror')
    page.locator('#rainbow').check(force=True)
    page.locator('#clear').click()
    drag([(200, 200), (260, 260), (330, 230), (380, 300)])
    check('smoothing works with symmetry and rainbow', page.evaluate('__doodler.strokes.length') >= 2 and validate()['ok'], validate())
    page.locator('#rainbow').uncheck(force=True)
    page.locator('#symmetry').select_option('off')
    setting('#smoothing', 0)
    page.locator('[data-tab=json]').click()
    page.locator('#out').click()
    page.keyboard.type('gi')
    page.locator('[data-tab=draw]').click()
    check('G and I are ignored while typing', not page.locator('#gridOn').is_checked() and 'gi' in page.locator('#out').input_value())
    print('PRECISION summary', sum(checks), '/', len(checks))
    b.close()

print('errors', errors)
