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

    POP_BUTTONS = {'popGallery': '#galleryBtn', 'popInsert': '#insertBtn', 'popActions': '#actionsBtn', 'popGuides': '#guidesBtn', 'popColor': '#colorBtn',
                   'popBrush': '[data-tool=pen]', 'popEraser': '[data-tool=eraser]', 'popFill': '[data-tool=fill]', 'popLayers': '#layersBtn'}
    def open_pop():
        return page.evaluate('document.querySelector(".pop:popover-open")?.id ?? null')
    def close_pops():
        page.evaluate('document.querySelectorAll(".pop:popover-open").forEach(p => p.hidePopover())')
    def ui(sel):
        pop, tab = page.evaluate('s => { const el = document.querySelector(s); return [el.closest("[popover]")?.id ?? null, el.closest("[data-panel]")?.dataset.panel ?? null]; }', sel)
        if pop and open_pop() != pop:
            close_pops()
            button = page.locator(POP_BUTTONS[pop])
            if button.get_attribute('aria-pressed') == 'false': button.click()
            button.click()
        if tab: page.locator(f'[data-tab={tab}]').click()
        return page.locator(sel)
    def act(sel, method='click', *args, **kw):
        getattr(ui(sel), method)(*args, **kw)
        close_pops()

    drag([(60, 60), (120, 90), (180, 60), (240, 120)])
    page.keyboard.press('l'); drag([(60, 200), (300, 260)])
    page.keyboard.press('o'); drag([(80, 300), (200, 380)])
    page.keyboard.press('b')
    act('#symmetry', 'select_option', label='Kaleido 12')
    act('#rainbow', 'check', force=True)
    drag([(box['width'] / 2 + 20, box['height'] / 2), (box['width'] / 2 + 80, box['height'] / 2 + 40), (box['width'] / 2 + 120, box['height'] / 2 - 30)])
    act('#rainbow', 'uncheck', force=True)
    act('#symmetry', 'select_option', 'off')
    print('after drawing', validate())
    n = page.evaluate('__doodler.strokes.length')
    page.keyboard.press('e'); drag([(60, 60), (120, 90)]); page.keyboard.press('b')
    print('erased', n, '->', page.evaluate('__doodler.strokes.length'))
    page.keyboard.press('Control+z'); print('undo ->', page.evaluate('__doodler.strokes.length'))
    page.keyboard.press('Control+Shift+z'); print('redo ->', page.evaluate('__doodler.strokes.length'))
    page.screenshot(path=str(OUT / f'1-draw{SUFFIX}.png'))

    act('#clear', 'click')
    page.locator('#svgFile').set_input_files(str(OUT / 'shapes.svg'))
    page.wait_for_timeout(300)
    page.locator('#importPreset').select_option('detailed')
    page.wait_for_timeout(300)
    page.locator('#importColors').select_option('exact')
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / f'2-svg-pending{SUFFIX}.png'))
    page.locator('#importDone').click()
    print('svg detailed exact', validate(), page.locator('#status').inner_text())
    page.screenshot(path=str(OUT / f'2-svg{SUFFIX}.png'))

    png = page.evaluate('''() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300);
      x.fillStyle = '#e53935'; x.beginPath(); x.arc(120, 150, 80, 0, 7); x.fill();
      x.fillStyle = '#1e88e5'; x.fillRect(230, 60, 120, 180); x.font = 'bold 60px sans-serif'; x.fillStyle = '#222'; x.fillText('Hi', 160, 280);
      return c.toDataURL('image/png').split(',')[1]; }''')
    (OUT / 'photo.png').write_bytes(base64.b64decode(png))
    act('#clear', 'click')
    page.locator('#photoFile').set_input_files(str(OUT / 'photo.png'))
    page.wait_for_timeout(1000)
    page.locator('#importColors').select_option('snap')
    page.wait_for_timeout(1000)
    page.locator('#importDone').click()
    print('photo colours', validate(), page.locator('#status').inner_text())
    page.screenshot(path=str(OUT / f'3-photo{SUFFIX}.png'))

    act('#clear', 'click')
    act('#text', 'fill', 'Hello from far away, dear friend!')
    act('#writeText', 'click')
    page.wait_for_timeout(800)
    page.locator('#importDone').click()
    print('text', validate(), page.locator('#status').inner_text())
    page.screenshot(path=str(OUT / f'4-text{SUFFIX}.png'))

    act('#replaySpeed', 'select_option', '8')
    act('#replay', 'click')
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / f'5-replay-mid{SUFFIX}.png'))
    page.wait_for_timeout(8000)
    print('replay button', page.locator('#replay i').get_attribute('data-glyph'))

    act('#libName', 'fill', 'greeting')
    act('#libSave', 'click')
    page.wait_for_timeout(300)
    print('library cards', page.locator('#libList .card').count())
    act('#dark', 'check', force=True)
    ui('#libList')
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / f'6-library-dark{SUFFIX}.png'))
    close_pops()
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
    act('#rainbow', 'check', force=True)
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
    act('#rainbow', 'uncheck', force=True)
    act('#clear', 'click')
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

    act('#clear', 'click')
    page.locator('#weight').evaluate('el => { el.value = 6; el.dispatchEvent(new Event("input", {bubbles: true})); }')
    act('[title=red]', 'click')
    drag([(100, 100), (300, 100)])
    page.locator('#weight').evaluate('el => { el.value = 1; el.dispatchEvent(new Event("input", {bubbles: true})); }')
    act('[title=blue]', 'click')
    drag([(100, 200), (300, 200)])
    act('[title=black]', 'click')
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
    act('#out', 'fill', '{"sdj": {"version": 1, "canvas": {"width": 720, "height": 960}, "palette": {}, "strokes": [{"color": "cff00ff", "weight": 3, "startOffset": 0, "points": [[100, 700, 0], [300, 700, 80]]}]}}')
    act('#load', 'click')
    act('[title=black]', 'click')
    after_load = page.locator('#colors button').count()
    page.keyboard.down('Alt')
    page.mouse.click(box['x'] + 200 / k, box['y'] + 700 / k)
    page.keyboard.up('Alt')
    check('picked colour missing from the palette bar is added', page.locator('#colors button').count() == after_load + (0 if after_load > swatches else 1), (swatches, after_load, page.locator('#colors button').count()))

    act('#clear', 'click')
    act('[title=black]', 'click')
    page.keyboard.press('g')
    check('G shows the grid', page.evaluate('document.querySelectorAll("#guides path").length') == 3 and page.locator('#gridOn').is_checked())
    check('guides sit between ref and ink', page.evaluate('[...document.querySelector("#board").children].map(e => e.id).join()').startswith('ref,guides,ink,'))
    check('guides use non-scaling hairlines', page.evaluate('[...document.querySelectorAll("#guides path")].every(p => getComputedStyle(p).vectorEffect === "non-scaling-stroke")'))
    check('grid is not in the exported SDJ', 'guides' not in page.locator('#out').input_value() and '"canvas"' in page.locator('#out').input_value())
    page.screenshot(path=str(OUT / f'8-grid{SUFFIX}.png'))
    page.keyboard.press('g')
    check('G hides the grid', page.evaluate('document.querySelectorAll("#guides path").length') == 0)

    page.keyboard.press('g')
    act('#snapOn', 'check', force=True)
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

    act('#clear', 'click')
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
    act('#dark', 'check', force=True)
    page.keyboard.press('b')
    drag([(100, 700), (200, 640), (300, 700)])
    page.screenshot(path=str(OUT / f'10-grid-dark{SUFFIX}.png'))
    act('#dark', 'uncheck', force=True)

    page.reload(); page.wait_for_timeout(500)
    check('grid, snap and spacing persist', page.locator('#gridOn').is_checked() and page.locator('#snapOn').is_checked() and page.locator('#gridSpacing').input_value() == '48')
    page.keyboard.press('g')
    act('#snapOn', 'uncheck', force=True)
    act('#clear', 'click')
    page.keyboard.press('b')

    def zigzag(smoothing, symmetric=False):
        setting('#smoothing', smoothing)
        act('#clear', 'click')
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
    act('#symmetry', 'select_option', label='Mirror')
    act('#rainbow', 'check', force=True)
    act('#clear', 'click')
    drag([(200, 200), (260, 260), (330, 230), (380, 300)])
    check('smoothing works with symmetry and rainbow', page.evaluate('__doodler.strokes.length') >= 2 and validate()['ok'], validate())
    act('#rainbow', 'uncheck', force=True)
    act('#symmetry', 'select_option', 'off')
    setting('#smoothing', 0)
    ui('#out').click()
    page.keyboard.type('gi')
    close_pops()
    check('G and I are ignored while typing', not page.locator('#gridOn').is_checked() and 'gi' in page.locator('#out').input_value())
    print('PRECISION summary', sum(checks), '/', len(checks))
    act('#rainbow', 'uncheck', force=True)

    act('#clear', 'click')
    act('#dark', 'uncheck', force=True)
    U = box['width'] / 720
    def cv(x, y):
        b = page.locator('#board').bounding_box()
        return (b['x'] + x * b['width'] / 720, b['y'] + y * b['width'] / 720)
    def mouse_path(pts, shift=False):
        if shift: page.keyboard.down('Shift')
        page.mouse.move(*cv(*pts[0])); page.mouse.down()
        for x, y in pts[1:]: page.mouse.move(*cv(x, y), steps=5)
        page.mouse.up()
        if shift: page.keyboard.up('Shift')
    def pen(pts):
        page.keyboard.press('b'); mouse_path(pts)
    def S(): return page.evaluate('__doodler.strokes')
    def layers(): return page.evaluate('__doodler.layers')
    def active(): return page.evaluate('__doodler.active')
    def halos(): return page.locator('#sel .halo').count()
    def bbox(strokes):
        ps = [p for s in strokes for p in s['points']]
        return min(p[0] for p in ps), min(p[1] for p in ps), max(p[0] for p in ps), max(p[1] for p in ps)
    def handle(name):
        r = page.locator(f'#sel [data-h={name}]').bounding_box()
        return r['x'] + r['width'] / 2, r['y'] + r['height'] / 2
    def screen_drag(a, b_, shift=False):
        if shift: page.keyboard.down('Shift')
        page.mouse.move(*a); page.mouse.down(); page.mouse.move(*b_, steps=8); page.mouse.up()
        if shift: page.keyboard.up('Shift')
    def undo_to(n):
        for _ in range(30):
            if page.evaluate('__doodler.strokes.length') == n: break
            page.keyboard.press('Control+z')
    def click_at(p, shift=False):
        if shift: page.keyboard.down('Shift')
        page.mouse.click(*p)
        if shift: page.keyboard.up('Shift')
    def close(a, b_, eps=0.6): return all(abs(x - y) <= eps for x, y in zip(a, b_))

    pen([(100, 100), (250, 150), (150, 250)])
    pen([(400, 120), (550, 200), (420, 260)])
    pen([(300, 600), (450, 700), (300, 800)])
    check = lambda name, ok, info='': print(('ok   ' if ok else 'FAIL ') + name, info)
    base = S()
    page.keyboard.press('s')
    check('select tool button pressed', page.locator('#selectTool[aria-pressed=true]').count() == 1)

    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])
    check('lasso selects the two strokes inside', halos() == 2 and page.locator('#sel .handle').count() == 5, halos())
    page.screenshot(path=str(OUT / f'8-select-light{SUFFIX}.png'))

    page.mouse.click(*cv(600, 900))
    check('click on empty canvas deselects', halos() == 0)
    page.mouse.click(*cv(300, 600))
    check('click selects one stroke', halos() == 1 and abs(bbox(S()[2:3])[1] - 600) < 1)
    click_at(cv(100, 100), True)
    check('shift click adds a stroke', halos() == 2)
    click_at(cv(300, 600), True)
    check('shift click removes a stroke', halos() == 1)
    page.keyboard.press('Escape')
    check('Escape deselects', halos() == 0)
    page.keyboard.press('Control+a')
    check('Ctrl+A selects all', halos() == 3)
    page.keyboard.press('Escape')
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])

    n0 = len(S())
    b0 = bbox(S()[:2])
    cx, cy = cv((b0[0] + b0[2]) / 2, (b0[1] + b0[3]) / 2)
    screen_drag((cx, cy), (cx + 60, cy + 30))
    s1 = S()
    dx, dy = 60 / U, 30 / U
    check('move shifts every selected stroke by the pointer delta', close(bbox(s1[:2]), (b0[0] + dx, b0[1] + dy, b0[2] + dx, b0[3] + dy)), bbox(s1[:2]))
    check('move keeps the unselected stroke and the timing',
          s1[2] == base[2] and [s['startOffset'] for s in s1] == [s['startOffset'] for s in base]
          and [[p[2] for p in s['points']] for s in s1] == [[p[2] for p in s['points']] for s in base])
    page.keyboard.press('Control+z')
    check('move is one undo step', S() == base and halos() == 0)
    page.keyboard.press('Control+Shift+z')
    check('redo brings the move back', close(bbox(S()[:2]), bbox(s1[:2])))
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])
    page.screenshot(path=str(OUT / f'9-select-moved{SUFFIX}.png'))
    page.keyboard.press('Control+z')
    check('undo back to the start', S() == base)
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])

    b0 = bbox(S()[:2])
    hx, hy = handle('se')
    screen_drag((hx, hy), (hx + 80, hy + 5))
    b1 = bbox(S()[:2])
    sx, sy = (b1[2] - b1[0]) / (b0[2] - b0[0]), (b1[3] - b1[1]) / (b0[3] - b0[1])
    check('corner handle scales uniformly around the opposite corner', abs(sx - sy) < 0.01 and sx > 1.05 and close(b1[:2], b0[:2], 0.1), (sx, sy))
    page.keyboard.press('Control+z')
    check('scale is one undo step', S() == base)
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])
    hx, hy = handle('se')
    screen_drag((hx, hy), (hx + 80, hy + 5), shift=True)
    b2 = bbox(S()[:2])
    sx, sy = (b2[2] - b2[0]) / (b0[2] - b0[0]), (b2[3] - b2[1]) / (b0[3] - b0[1])
    check('shift scales freely', sx > 1.05 and abs(sy - 1) < 0.05, (sx, sy))
    page.keyboard.press('Control+z')
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])

    hx, hy = handle('nw'); ax, ay = handle('se')
    screen_drag((hx, hy), (hx + 40, hy + 40))
    b3 = bbox(S()[:2])
    check('the opposite corner stays put while scaling', close(b3[2:], b0[2:], 0.1) and b3[0] > b0[0], b3)
    page.keyboard.press('Control+z')
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])

    ccx, ccy = (b0[0] + b0[2]) / 2, (b0[1] + b0[3]) / 2
    rx, ry = handle('rot')
    r = ((rx - cv(ccx, ccy)[0]) ** 2 + (ry - cv(ccx, ccy)[1]) ** 2) ** 0.5
    pcx, pcy = cv(ccx, ccy)
    screen_drag((rx, ry), (pcx, pcy + r))
    p0, p1 = base[0]['points'][0], S()[0]['points'][0]
    ex, ey = 2 * ccx - p0[0], 2 * ccy - p0[1]
    check('rotation handle turns the selection 180 degrees', close((p1[0], p1[1]), (ex, ey), 1.0), ((p1[0], p1[1]), (ex, ey)))
    page.keyboard.press('Control+z')
    check('rotate is one undo step', S() == base)
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])
    rx, ry = handle('rot')
    import math
    ang = math.radians(23)
    screen_drag((rx, ry), (pcx + r * math.sin(ang), pcy - r * math.cos(ang)), shift=True)
    q = S()[0]['points'][0]
    got = math.degrees(math.atan2(q[1] - ccy, q[0] - ccx) - math.atan2(p0[1] - ccy, p0[0] - ccx)) % 360
    check('shift snaps rotation to 15 degrees', abs(got - 30) < 1.0 or abs(got % 15) < 1.0, got)
    page.keyboard.press('Control+z')
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])

    for _ in range(3): page.keyboard.press('ArrowRight')
    page.keyboard.press('Shift+ArrowDown')
    b4 = bbox(S()[:2])
    check('arrows nudge by 1 and shift+arrow by 10', close(b4, (b0[0] + 3, b0[1] + 10, b0[2] + 3, b0[3] + 10), 0.1), b4)
    page.keyboard.press('Control+z')
    check('a run of nudges is one undo step', S() == base)
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])

    page.locator('.dock .drawing-tool-group button').first.click()
    fb = bbox(S()[:2])
    check('flip horizontal mirrors around the selection centre', close((fb[0], fb[2]), (b0[0], b0[2]), 0.1) and S()[0]['points'][0][0] != base[0]['points'][0][0]
          and close(((S()[0]['points'][0][0] + base[0]['points'][0][0]) / 2,), ((b0[0] + b0[2]) / 2,), 0.1))
    page.locator('.dock .drawing-tool-group button').nth(1).click()
    check('flip vertical keeps the bounding box', close(bbox(S()[:2]), b0, 0.1) and S()[0]['points'][0][1] != base[0]['points'][0][1])
    page.keyboard.press('Control+z'); page.keyboard.press('Control+z')
    check('flips undo one by one', S() == base)
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])

    act('#colors button[title=red]', 'click')
    cols = [s['color'] for s in S()]
    check('palette colour recolours only the selection', cols == ['red', 'red', 'black'], cols)
    page.keyboard.press('Control+z')
    check('recolour is one undo step', [s['color'] for s in S()] == ['black'] * 3)
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])
    page.keyboard.press(']')
    page.keyboard.press(']')
    ws = [s['weight'] for s in S()]
    check('weight keys change the selected strokes', ws == [4, 4, 3], ws)
    page.keyboard.press('Control+z')
    check('a run of weight steps is one undo step', [s['weight'] for s in S()] == [3, 3, 3])

    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])
    page.keyboard.press('Control+d')
    s2 = S()
    end = max(s['startOffset'] + s['points'][-1][2] for s in base)
    check('duplicate adds copies', len(s2) == 5 and halos() == 2)
    check('copies start after the original timeline ends', min(s['startOffset'] for s in s2[3:]) >= end + 400 - 1, (s2[3]['startOffset'], end))
    check('copies are offset by 16 units', close(bbox(s2[3:]), (b0[0] + 16, b0[1] + 16, b0[2] + 16, b0[3] + 16), 0.1), bbox(s2[3:]))
    page.screenshot(path=str(OUT / f'10-select-duplicate{SUFFIX}.png'))
    check('timeline order of the copies mirrors the originals',
          s2[4]['startOffset'] - s2[3]['startOffset'] == base[1]['startOffset'] - base[0]['startOffset'])
    page.keyboard.press('Control+z')
    check('duplicate is one undo step', S() == base)

    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])
    page.keyboard.press('Control+c')
    page.keyboard.press('Control+v')
    check('copy then paste adds the strokes selected', len(S()) == 5 and halos() == 2, len(S()))
    page.keyboard.press('Control+v')
    check('paste again adds another set', len(S()) == 7)
    check('pasted strokes come last in the timeline', min(s['startOffset'] for s in S()[5:]) > max(s['startOffset'] + s['points'][-1][2] for s in S()[:5]))
    undo_to(3)
    page.keyboard.press('Escape')
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])
    page.keyboard.press('Control+x')
    check('cut removes the selection', len(S()) == 1 and halos() == 0)
    page.keyboard.press('Control+v')
    check('paste after cut restores the strokes in place', len(S()) == 3 and close(bbox(S()[1:]), b0, 0.1), bbox(S()[1:]))
    check('result passes the Slowly validator', validate()['ok'], validate())
    page.keyboard.press('Control+z'); page.keyboard.press('Control+z')
    check('cut and paste undo to the start', S() == base)

    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])
    page.keyboard.press('Delete')
    check('Delete removes the selection', len(S()) == 1 and halos() == 0)
    page.keyboard.press('Control+z')
    check('undo of delete restores them', S() == base)

    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])
    check('select bar shows five buttons while a selection exists', page.locator('.dock button:visible').count() == 5, page.locator('.dock button:visible').count())
    page.locator('.dock button[title^=Duplicate]').click()
    check('bar Duplicate adds copies and selects them', len(S()) == 5 and halos() == 2, len(S()))
    page.locator('.dock button[title^=Copy]').click()
    check('bar Copy says how many strokes it copied', 'copied 2 strokes' in page.locator('#status').inner_text(), page.locator('#status').inner_text())
    page.locator('.dock button[title^=Delete]').click()
    check('bar Delete removes the selection', S() == base and halos() == 0)
    check('select bar hides without a selection', page.locator('.dock button:visible').count() == 0)

    ui('#out').focus()
    page.keyboard.press('Control+a')
    sel_len = page.evaluate('(() => { const o = document.getElementById("out"); return o.selectionEnd - o.selectionStart === o.value.length; })()')
    page.keyboard.press('Control+c')
    page.keyboard.press('Backspace')
    check('text field keeps Ctrl+A and Backspace to itself', sel_len and len(S()) == 3 and page.locator('#out').input_value() == '')
    page.keyboard.press('Control+v')
    check('text field keeps Ctrl+V', page.locator('#out').input_value().startswith('{') and len(S()) == 3)
    act('#load', 'click')
    check('the copied JSON loads back', len(S()) == 3 and validate()['ok'])

    page.keyboard.press('s')
    mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])
    big = page.evaluate('''() => ({ version: 1, canvas: { width: 720, height: 960 }, palette: { black: { light: '#222222', dark: '#F5F5F5' } },
      strokes: Array.from({ length: 999 }, (_, i) => ({ color: 'black', weight: 3, startOffset: i * 10, points: [[10, 10, 0], [20 + i % 50, 20, 5]] })) })''')
    act('#out', 'fill', json.dumps(big))
    act('#load', 'click')
    page.keyboard.press('Control+a')
    page.keyboard.press('Control+d')
    err = page.locator('#status').inner_text()
    check('paste over the stroke limit is refused with an error', len(S()) == 999 and page.locator('#status.error').count() == 1 and 'too many strokes' in err, err)

    act('#clear', 'click')
    pen([(100, 100), (250, 150), (150, 250)]); pen([(400, 120), (550, 200), (420, 260)]); pen([(300, 600), (450, 700), (300, 800)])
    page.keyboard.press('s'); mouse_path([(60, 60), (620, 60), (620, 330), (60, 330)])
    def zoom_on_selection(wheels):
        mid = page.evaluate('(() => { const r = document.querySelector("#sel .box").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()')
        page.mouse.move(*mid)
        page.keyboard.down('Control')
        for _ in range(wheels): page.mouse.wheel(0, -30)
        page.keyboard.up('Control')
        page.wait_for_timeout(100)
        return mid
    zoom_on_selection(3)
    ppu = page.evaluate('document.querySelector("#board").getScreenCTM().a')
    page.screenshot(path=str(OUT / f'11-select-zoom{SUFFIX}.png'))
    zb = bbox(S()[:2])
    mid = page.evaluate('(() => { const r = document.querySelector("#sel .box").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()')
    screen_drag(tuple(mid), (mid[0] + 50, mid[1] + 20))
    zb2 = bbox(S()[:2])
    check('move works at zoom with screen-sized deltas', ppu > U * 2 and close((zb2[0] - zb[0], zb2[1] - zb[1]), (50 / ppu, 20 / ppu), 0.5), (ppu / U, zb2[0] - zb[0], zb2[1] - zb[1]))
    hs = page.locator('#sel .handle').first.bounding_box()
    check('handles keep their screen size at zoom', abs(hs['width'] - 11.5) < 1, hs['width'])
    page.keyboard.press('0')
    act('#dark', 'check', force=True)
    page.screenshot(path=str(OUT / f'12-select-dark{SUFFIX}.png'))
    zoom_on_selection(3)
    page.screenshot(path=str(OUT / f'13-select-dark-zoom{SUFFIX}.png'))
    page.keyboard.press('0')
    page.keyboard.press('b')
    check('leaving the select tool drops the selection', halos() == 0 and page.locator('#sel .handle').count() == 0)
    act('#dark', 'uncheck', force=True)
    act('#rainbow', 'uncheck', force=True)
    act('#clear', 'click')
    act('#eraserMode', 'select_option', 'cut')
    page.keyboard.press('l'); drag([(100, 500), (400, 500)])
    page.keyboard.press('e')
    page.mouse.move(box['x'] + 250, box['y'] + 460)
    ring = page.evaluate('''() => { const r = document.getElementById('eraserRing'); return [r.style.display, r.getAttribute('r')]; }''')
    page.mouse.down(); page.mouse.move(box['x'] + 250, box['y'] + 520, steps=6)
    live = page.evaluate('[__doodler.strokes.length, document.querySelectorAll("#ink path").length]')
    page.screenshot(path=str(OUT / f'8-cut{SUFFIX}.png'))
    page.mouse.up()
    cut = page.evaluate('__doodler.strokes.map(s => [s.startOffset, s.points.map(p => p.join(","))])')
    print('cut eraser', ring, 'while dragging [committed, drawn]', live, 'pieces', len(cut), cut)
    assert ring[0] == '' and live == [1, 2] and len(cut) == 2 and cut[1][0] > cut[0][0] and cut[1][1][0].endswith(',0')
    page.keyboard.press('Control+z'); print('cut undo is one step ->', page.evaluate('__doodler.strokes.length'))
    act('#eraserMode', 'select_option', 'whole')

    act('#clear', 'click')
    page.keyboard.press('o'); drag([(100, 200), (400, 420)])
    page.keyboard.press('f')
    cx, cy = 250, 310
    def fill_report():
        return page.evaluate('''() => { const [e, ...fill] = __doodler.strokes;
          const xs = e.points.map(p => p[0]), ys = e.points.map(p => p[1]);
          const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
          const rx = (Math.max(...xs) - Math.min(...xs)) / 2, ry = (Math.max(...ys) - Math.min(...ys)) / 2;
          const worst = Math.max(0, ...fill.flatMap(s => s.points.map(p => ((p[0] - mx) / rx) ** 2 + ((p[1] - my) / ry) ** 2)));
          const ordered = fill.every((s, i) => i === 0 || s.startOffset >= fill[i - 1].startOffset);
          return { fill: fill.length, worst, ordered, first: e.startOffset + e.points.at(-1)[2], start: fill[0]?.startOffset }; }''')
    page.mouse.click(box['x'] + cx, box['y'] + cy)
    hatch = fill_report()
    print('fill hatch', hatch, validate(), page.locator('#status').inner_text())
    assert hatch['fill'] > 5 and hatch['worst'] < 1 and hatch['ordered'] and hatch['start'] > hatch['first'] and validate()['ok']
    page.screenshot(path=str(OUT / f'9-fill{SUFFIX}.png'))
    page.keyboard.press('Control+z'); print('fill undo is one step ->', page.evaluate('__doodler.strokes.length'))
    act('#fillStyle', 'select_option', 'cross')
    act('#fillAngle', 'fill', '30')
    page.keyboard.press('f')
    page.mouse.click(box['x'] + cx, box['y'] + cy)
    cross = fill_report()
    print('fill cross-hatch', cross, validate())
    assert cross['fill'] > hatch['fill'] and cross['worst'] < 1
    act('#fillStyle', 'select_option', 'scribble')
    page.keyboard.press('Control+z')
    page.keyboard.press('f')
    page.mouse.click(box['x'] + cx, box['y'] + cy)
    scribble = fill_report()
    print('fill scribble', scribble, validate())
    assert 0 < scribble['fill'] < hatch['fill'] and scribble['worst'] < 1
    page.mouse.click(box['x'] + 30, box['y'] + 30)
    print('fill outside', page.evaluate('__doodler.strokes.length'), page.locator('#status').inner_text())
    act('#dark', 'check', force=True)
    page.screenshot(path=str(OUT / f'9-fill-dark{SUFFIX}.png'))
    act('#dark', 'uncheck', force=True)

    def load_square(extra):
        sq = [{'color': 'black', 'weight': 3, 'startOffset': i * 300, 'points': pts} for i, pts in enumerate([
            [[100, 100, 0], [500, 100, 100]], [[500, 100, 0], [500, 500, 100]], [[500, 500, 0], [100, 500, 100]], [[100, 500, 0], [100, 100, 100]]])]
        act('#out', 'fill', json.dumps({'sdj': {'version': 1, 'canvas': {'width': 720, 'height': 960}, 'palette': {'black': {'light': '#222222', 'dark': '#F5F5F5'}}, 'strokes': sq + extra}}))
        act('#load', 'click')
    scale = box['width'] / 720
    act('#fillStyle', 'select_option', 'hatch')
    act('#addColor', 'click')
    load_square([])
    page.keyboard.press('f')
    page.mouse.click(box['x'] + 300 * scale, box['y'] + 300 * scale)
    custom = page.evaluate('[__doodler.strokes.length, __doodler.strokes.at(-1).color]')
    print('fill closed square in a custom colour', custom, page.locator('#status').inner_text(), validate())
    assert custom[0] > 10 and custom[1] == 'c7e57c2' and 'page edge' not in page.locator('#status').inner_text()
    gap = {'color': 'canvas', 'weight': 6, 'startOffset': 2000, 'points': [[250, 100, 0], [350, 100, 50]]}
    load_square([gap])
    page.keyboard.press('f')
    page.mouse.click(box['x'] + 300 * scale, box['y'] + 300 * scale)
    print('fill through a canvas-coloured gap', page.locator('#status').inner_text())
    assert 'page edge' in page.locator('#status').inner_text()

    act('#clear')
    check('layers button sits next to the colour', page.evaluate('document.getElementById("layersBtn").nextElementSibling.id') == 'colorBtn')
    check('tools with options carry a dot', page.evaluate('[...document.querySelectorAll("[data-tool]")].filter(b => getComputedStyle(b, "::after").content !== "none").map(b => b.dataset.tool).join()') == 'pen,line,ellipse,eraser,fill')
    symmetries = lambda: page.evaluate('[document.getElementById("symmetry").value, document.getElementById("symmetryBrush").value]')
    page.keyboard.press('b')
    act('#symmetryBrush', 'select_option', 'quad')
    check('symmetry set in the pen popover shows in the guides popover', symmetries() == ['quad', 'quad'], symmetries())
    act('#symmetry', 'select_option', 'mirror')
    check('symmetry set in the guides popover shows in the pen popover', symmetries() == ['mirror', 'mirror'], symmetries())
    mouse_path([(100, 100), (300, 200)])
    check('both symmetry controls drive the same drawing mode', len(S()) == 2, len(S()))
    act('#symmetryBrush', 'select_option', 'off')
    act('#clear')
    def preview(): return page.evaluate('[...document.querySelectorAll("#ink path")].map(p => p.getAttribute("stroke-width"))')
    def preview_box(): return page.evaluate('(() => { const b = document.getElementById("ink").getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height]; })()')
    def import_bar(): return page.locator('#importBar').is_visible()
    def set_input(id, value):
        page.evaluate('([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input", {bubbles: true})); }', [id, str(value)])
    svg_cases = page.evaluate('''async () => {
      const run = async (body, opts = {}) => (await __doodler.importSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`, { weight: 2, ...opts })).polylines;
      const many = Array.from({ length: 3000 }, (_, i) => `<circle cx="${i % 60 * 1.6 + 2}" cy="${Math.floor(i / 60) * 1.9 + 2}" r="0.6" fill="red"/>`).join('');
      return {
        thin: await run('<path d="M10 50 C 30 20, 70 80, 90 50" stroke="#000" stroke-width="1" fill="none"/>'),
        square: await run('<rect x="20" y="20" width="60" height="60" fill="#1e88e5"/>'),
        bar: await run('<rect x="10" y="49.5" width="80" height="1" fill="#000"/>'),
        use: await run('<defs><path id="p" d="M0 0 L10 0" stroke="#000"/></defs><use href="#p" x="10" y="10"/><use href="#p" x="10" y="90"/>'),
        gradient: await run('<defs><linearGradient id="g"><stop offset="0" stop-color="#e53935"/><stop offset="1" stop-color="#e53935"/></linearGradient></defs><rect x="10" y="10" width="80" height="80" fill="url(#g)"/>'),
        many: await run(many, { fills: 'hatch' }),
      };
    }''')
    thin = svg_cases['thin']
    check('a thin stroked SVG path becomes one stroke at the import weight', len(thin) == 1 and thin[0]['weight'] == 2, len(thin))
    sq = svg_cases['square'][0]['pts'] if svg_cases['square'] else []
    xs, ys = [p[0] for p in sq], [p[1] for p in sq]
    check('a filled square traces to its outline', len(svg_cases['square']) == 1 and 4 <= len(sq) <= 6 and max(xs) - min(xs) > 600 and abs((max(xs) - min(xs)) - (max(ys) - min(ys))) < 1,
          (len(svg_cases['square']), len(sq)))
    bar = svg_cases['bar']
    check('a thin filled bar becomes one centre line, not an outline', len(bar) == 1 and max(p[1] for p in bar[0]['pts']) - min(p[1] for p in bar[0]['pts']) < 3, [len(b['pts']) for b in bar])
    check('<use> copies are drawn and the <defs> original is not', len(svg_cases['use']) == 2, len(svg_cases['use']))
    check('a gradient fill is drawn in its stop colour', [p['color'] for p in svg_cases['gradient']] == ['red'], [p['color'] for p in svg_cases['gradient']])
    many = svg_cases['many']
    check('a busy SVG stays within the limits', 900 <= len(many) <= 1000 and sum(len(p['pts']) for p in many) <= 249998, len(many))
    page.keyboard.press('b')
    names = [l['name'] for l in layers()]
    ui('#svgFile').set_input_files(str(OUT / 'shapes.svg'))
    page.wait_for_timeout(500)
    check('choosing a file closes the insert popover and opens the import bar', open_pop() is None and import_bar())
    check('the preview is shown but not yet in the drawing', len(S()) == 0 and len(preview()) > 0, (len(S()), len(preview())))
    check('the preview gets no layer before Done', [l['name'] for l in layers()] == names, layers())
    check('the preview shows its own colours under a frame, no halo', halos() == 0 and page.locator('#sel .handle').count() > 0, halos())
    paper_bottom = page.evaluate('document.querySelector(".paper").getBoundingClientRect().bottom')
    bar_top = page.evaluate('document.getElementById("importBar").getBoundingClientRect().top')
    check('the import bar does not cover the paper', paper_bottom <= bar_top, (paper_bottom, bar_top))
    set_input('importWeight', 5)
    page.wait_for_timeout(500)
    check('the import bar weight sets the weight of the preview', preview() and all(w == '10' for w in preview()), set(preview()))
    b0 = preview_box()
    centre = ((b0[0] + b0[2]) / 2, (b0[1] + b0[3]) / 2)
    mouse_path([centre, (centre[0] - 20, centre[1] + 40)])
    b1 = preview_box()
    check('dragging the preview moves it', close(b1, (b0[0] - 20, b0[1] + 40, b0[2] - 20, b0[3] + 40), 1.5) and len(S()) == 0, (b0, b1))
    set_input('importDetail', 70)
    page.wait_for_timeout(600)
    b2 = preview_box()
    check('changing detail keeps the placement', abs(b2[0] - b1[0]) < 6 and abs(b2[1] - b1[1]) < 6, (b1, b2))
    n = len(preview())
    page.locator('#importDone').click()
    check('Done adds the import as it was previewed', len(S()) == n and all(s['weight'] == 5 for s in S()) and not import_bar(), (len(S()), n))
    check('Done puts the import on a new active layer named after the file', [l['name'] for l in layers()] == names + ['shapes'] and all(s['layer'] == active() == layers()[-1]['id'] for s in S()),
          (layers(), active()))
    check('the import stays selected after Done', halos() == n, halos())
    page.keyboard.press(']')
    check('the size slider keys reweight the committed import', all(s['weight'] == 5.5 for s in S()), {s['weight'] for s in S()})
    page.keyboard.press('Control+z')
    page.keyboard.press('Control+z')
    check('undo removes the whole import and its layer in one step', len(S()) == 0 and [l['name'] for l in layers()] == names, (len(S()), layers()))
    ui('#svgFile').set_input_files(str(OUT / 'shapes.svg'))
    page.wait_for_timeout(400)
    page.keyboard.press('Escape')
    check('Escape cancels the import', len(S()) == 0 and len(preview()) == 0 and not import_bar())
    ui('#svgFile').set_input_files(str(OUT / 'shapes.svg'))
    page.wait_for_timeout(400)
    page.keyboard.press('Control+z')
    check('undo while placing cancels the import', len(S()) == 0 and not import_bar())
    def preview_paths(): return page.evaluate('[...document.querySelectorAll("#ink path")].map(p => p.getAttribute("d"))')
    ui('#svgFile').set_input_files(str(OUT / 'shapes.svg'))
    page.wait_for_timeout(500)
    plain = preview_paths()
    check('Hand-drawn is off by default', page.locator('#importRough').input_value() == '0')
    set_input('importRough', 1)
    page.wait_for_timeout(600)
    sketched = preview_paths()
    check('Hand-drawn redraws the preview', sketched != plain and len(sketched) >= len(plain), (len(plain), len(sketched)))
    set_input('importDetail', 40)
    page.wait_for_timeout(600)
    set_input('importDetail', 15)
    page.wait_for_timeout(600)
    check('a retrace keeps the same hand-drawn look', preview_paths() == sketched)
    page.locator('#importDone').click()
    check('a hand-drawn import is a valid drawing', validate()['ok'] and len(S()) == len(sketched), validate())
    act('#clear')
    ui('#svgFile').set_input_files(str(OUT / 'shapes.svg'))
    page.wait_for_timeout(500)
    check('the next import starts with Hand-drawn off', page.locator('#importRough').input_value() == '0' and preview_paths() == plain)
    page.keyboard.press('Escape')
    page.evaluate('''(svg) => { const dt = new DataTransfer(); dt.items.add(new File([svg], 'drop.svg', { type: 'image/svg+xml' }));
      document.querySelector('.stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }''', SVG)
    page.wait_for_timeout(400)
    check('dropping an SVG on the canvas starts an import', import_bar() and len(preview()) > 0)
    page.keyboard.press('b')
    check('picking a tool finishes the import', len(S()) > 0 and not import_bar(), len(S()))
    act('#clear')
    page.evaluate('''async (b64) => { const blob = await (await fetch('data:image/png;base64,' + b64)).blob(); const dt = new DataTransfer();
      dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }''', png)
    page.wait_for_timeout(1200)
    check('pasting an image starts a photo import', import_bar() and len(preview()) > 0, len(preview()))
    page.keyboard.press('Enter')
    check('Enter finishes the import', len(S()) > 0 and not import_bar())
    act('#clear')
    fine_png = page.evaluate('''() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1600, 1200); x.fillStyle = '#222';
      for (let r = 0; r < 12; r++) { x.font = `${12 + 4 * r}px sans-serif`; x.fillText('the quick brown fox jumps', 40, 40 + r * 95); }
      return c.toDataURL('image/png').split(',')[1]; }''')
    (OUT / 'fine.png').write_bytes(base64.b64decode(fine_png))
    def preview_points(): return page.evaluate('[...document.querySelectorAll("#ink path")].reduce((n, p) => n + p.getAttribute("d").split(/[MQL]/).length - 1, 0)')
    ui('#photoFile').set_input_files(str(OUT / 'fine.png'))
    page.wait_for_timeout(1200)
    b0 = preview_box()
    screen_drag(handle('se'), cv(b0[0] + (b0[2] - b0[0]) / 2, b0[1] + (b0[3] - b0[1]) / 2))
    page.wait_for_timeout(1200)
    small = (len(preview()), preview_points())
    b1 = preview_box()
    screen_drag(handle('se'), cv(b1[0] + (b1[2] - b1[0]) * 2.6, b1[1] + (b1[3] - b1[1]) * 2.6))
    stretched, b2 = len(preview()), preview_box()
    page.wait_for_timeout(1200)
    big, b3 = (len(preview()), preview_points()), preview_box()
    check('scaling a placed photo up retraces it with more strokes and points', stretched == small[0] and big[0] > small[0] * 1.3 and big[1] > small[1] * 1.3, (small, big))
    check('the retrace keeps the placement: the largest text keeps its place, finer text may appear', close((b3[0], b3[3]), (b2[0], b2[3]), 8) and abs(b3[2] - b2[2]) <= 0.08 * (b2[2] - b2[0]) and b3[1] <= b2[1] + 8, (b2, b3))
    page.keyboard.press('Escape')
    act('#clear')
    page.keyboard.press('Shift+F')
    page.wait_for_timeout(300)
    check('Shift+F enters full screen', page.evaluate('!!document.fullscreenElement') and page.locator('#fullscreen').get_attribute('aria-pressed') == 'true')
    box = page.locator('#board').bounding_box()
    U = box['width'] / 720
    pen([(100, 100), (300, 200)])
    p0 = S()[-1]['points'][0]
    check('pointer maps to the canvas in full screen', abs(p0[0] - 100) < 2 and abs(p0[1] - 100) < 2, p0)
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    check('Escape leaves full screen and keeps the drawing', not page.evaluate('!!document.fullscreenElement') and len(S()) == 1,
          (page.evaluate('document.fullscreenElement?.tagName ?? null'), len(S()), page.evaluate('document.activeElement?.tagName')))
    act('#fullscreen')
    page.wait_for_timeout(300)
    check('the top bar button toggles full screen', page.evaluate('!!document.fullscreenElement'))
    act('#fullscreen')
    page.wait_for_timeout(300)
    box = page.locator('#board').bounding_box()
    U = box['width'] / 720
    act('#clear')
    page.locator('[data-tool=line]').click()
    check('tapping another tool selects it without opening options', page.locator('[data-tool=line]').get_attribute('aria-pressed') == 'true' and open_pop() is None)
    page.locator('[data-tool=line]').click()
    check('tapping the active tool opens its options', open_pop() == 'popBrush')
    page.keyboard.press('Escape')
    check('Escape closes the popover and focus returns to the tool', open_pop() is None and page.evaluate('document.activeElement.dataset.tool') == 'line')
    page.locator('#guidesBtn').click()
    page.locator('#colorBtn').click()
    check('one popover at a time', open_pop() == 'popColor')
    page.keyboard.press('b')
    mouse_path([(100, 100), (300, 300)])
    check('a tap on the canvas closes the popover and draws nothing', open_pop() is None and len(S()) == 0)
    page.locator('#actionsBtn').click()
    page.locator('[data-tab=share]').click()
    page.locator('#actionsBtn').click()
    page.keyboard.press('e')
    check('shortcuts work after a popover was used', open_pop() is None and page.locator('[data-tool=eraser]').get_attribute('aria-pressed') == 'true')
    page.keyboard.press('b')
    mouse_path([(100, 100), (300, 300)])
    check('drawing works after a popover closed', len(S()) == 1)
    page.locator('#pick').click()
    check('the modify square arms the eyedropper', page.locator('#pick[aria-pressed=true]').count() == 1 and 'picking' in page.locator('#board').get_attribute('class'))
    page.mouse.click(*cv(200, 200))
    check('a pick disarms it and says what it picked', page.locator('#pick[aria-pressed=false]').count() == 1 and 'picked ' in page.locator('#status').inner_text()
          and 'shown' in page.locator('#toast').get_attribute('class'))
    page.wait_for_timeout(3000)
    check('the toast fades out', 'shown' not in page.locator('#toast').get_attribute('class'))
    act('#text', 'fill', '')
    act('#writeText')
    page.wait_for_timeout(3000)
    check('an error toast stays longer', 'shown' in page.locator('#toast').get_attribute('class') and page.locator('#status.error').count() == 1)

    def status(): return page.locator('#status').inner_text()
    def sdj(): return json.loads(page.locator('#out').input_value())['sdj']
    def row(id, sel=''): return f'#layerList [data-layer={id}] {sel}'.strip()
    def lay(sel, method='click', *args, **kw):
        ui('#layerList')
        getattr(page.locator(sel), method)(*args, **kw)
        close_pops()
    act('#clear')
    act('[title=black]')
    page.keyboard.press('o'); mouse_path([(100, 100), (400, 400)])
    act('#layerAdd')
    check('+ adds Layer 2 above and makes it active', [l['name'] for l in layers()] == ['Layer 1', 'Layer 2'] and active() == 'l2', layers())
    pen([(100, 600), (600, 600)])
    check('each stroke belongs to the layer it was drawn on', [s['layer'] for s in S()] == ['l1', 'l2'], [s['layer'] for s in S()])
    ui('#layerList'); page.locator(row('l1')).click()
    check('the list shows the top layer first and a click selects a row', page.evaluate('[...document.querySelectorAll("#layerList [data-layer]")].map(r => r.dataset.layer).join()') == 'l2,l1'
          and active() == 'l1' and page.locator(row('l1', '.layer-actions')).count() == 1)
    close_pops()
    lay(row('l2'))
    lay(row('l1', '.layer-visible'))
    check('hiding a layer hides its strokes', layers()[0]['hidden'] and page.evaluate('[...document.querySelectorAll("#ink path")].map(p => p.style.display).join()') == 'none,')
    ui('#layerList')
    eye = page.locator(row('l1', '.layer-visible'))
    eye_box = eye.bounding_box()
    check('the eye toggle shows the state with aria-pressed and is a 36px target', eye.get_attribute('aria-pressed') == 'false' and eye.get_attribute('aria-label') == 'Show Layer 1'
          and page.locator(row('l2', '.layer-visible')).get_attribute('aria-pressed') == 'true' and (eye_box['width'], eye_box['height']) == (36, 36), eye_box)
    check('the panel head counts layers and the Layers button names the active one', page.locator('#layerCount').inner_text() == '2/10' and page.locator('#layersBtn').get_attribute('title') == 'Layers: Layer 2',
          (page.locator('#layerCount').inner_text(), page.locator('#layersBtn').get_attribute('title')))
    close_pops()
    check('the stroke counter counts what would be sent', page.locator('#stats').inner_text().strip() == '1/1000', page.locator('#stats').inner_text())
    check('the SDJ leaves the hidden layer out and passes the validator', validate() == {'ok': True, 'strokes': 1, 'palette': ['black']} and sdj()['strokes'][0]['points'][0][1] > 500, validate())
    page.keyboard.down('Alt'); page.mouse.click(*cv(100, 250)); page.keyboard.up('Alt')
    check('the eyedropper ignores a hidden layer', status() == 'no stroke under the pointer', status())
    ellipse = S()[0]
    page.keyboard.press('e'); mouse_path([(80, 250), (120, 250)])
    check('the eraser ignores a hidden layer', len(S()) == 2)
    act('#eraserMode', 'select_option', 'cut')
    page.keyboard.press('e'); mouse_path([(80, 250), (120, 250)])
    act('#eraserMode', 'select_option', 'whole')
    check('the cut eraser ignores a hidden layer', len(S()) == 2 and S()[0] == ellipse)
    page.keyboard.press('s'); mouse_path([(50, 50), (650, 50), (650, 650), (50, 650)])
    check('the lasso picks only visible strokes', halos() == 1)
    page.keyboard.press('Delete')
    check('deleting the lasso pick keeps the hidden layer', [s['layer'] for s in S()] == ['l1'])
    page.keyboard.press('Control+z')
    page.keyboard.press('f'); page.mouse.click(*cv(250, 250))
    fill = S()[2:]
    check('fill does not stop at a hidden outline', len(fill) > 0 and min(p[1] for s in fill for p in s['points']) < 90 and all(s['layer'] == 'l2' for s in fill), len(fill))
    page.keyboard.press('Control+z')
    sent = page.evaluate('''(wz) => { eval(wz); let msg = null; window.postMessage = m => { msg = m; };
      document.getElementById('send').click(); try { Wz(msg.sdj); return { ok: true, n: msg.sdj.strokes.length }; } catch (e) { return { ok: false, err: e.message }; } }''', WZ)
    check('Send flattens the visible layers into an SDJ the validator accepts', sent == {'ok': True, 'n': 1}, sent)
    check('Send says how many hidden strokes were left out', status() == '1 strokes on hidden layers were left out', status())
    lay(row('l1'))
    pen([(100, 700), (300, 700)])
    check('drawing on a hidden layer shows a toast and draws nothing', len(S()) == 2 and 'is hidden' in status() and page.locator('#status.error').count() == 1, status())
    page.keyboard.press('Control+z')
    check('undo brings a hidden layer back', not layers()[0]['hidden'] and page.evaluate('[...document.querySelectorAll("#ink path")].every(p => !p.style.display)'))
    lay(row('l1', '.layer-lock'))
    check('lock shows in the row', page.locator(row('l1', '.layer-lock[aria-pressed=true]')).count() == 1 and layers()[0]['locked'])
    close_pops()
    page.keyboard.press('e'); mouse_path([(80, 250), (120, 250)])
    page.keyboard.press('s'); mouse_path([(50, 50), (650, 50), (650, 650), (50, 650)])
    check('eraser and lasso skip a locked layer', len(S()) == 2 and halos() == 1)
    page.keyboard.press('Escape')
    pen([(100, 700), (300, 700)])
    check('drawing on a locked layer shows a toast', len(S()) == 2 and 'is locked' in status(), status())
    lay(row('l2'))
    act('[title=red]')
    page.keyboard.press('f'); page.mouse.click(*cv(250, 250))
    fill = S()[2:]
    x0, y0, x1, y1 = bbox(fill) if fill else (0, 0, 720, 960)
    check('fill stops at a locked outline and hatches the active layer', len(fill) > 0 and x0 >= 100 and y0 >= 100 and x1 <= 400 and y1 <= 400
          and all(s['layer'] == 'l2' and s['color'] == 'red' for s in fill), (len(fill), x0, y0, x1, y1))
    page.keyboard.press('Control+z')
    page.keyboard.press('b')
    page.keyboard.down('Alt'); page.mouse.click(*cv(100, 250)); page.keyboard.up('Alt')
    check('the eyedropper reads a locked layer', status().startswith('picked black'), status())
    lay(row('l1'))
    page.keyboard.press('f'); page.mouse.click(*cv(250, 250))
    check('fill onto a locked active layer shows a toast and draws nothing', len(S()) == 2 and 'is locked' in status() and page.locator('#status.error').count() == 1, status())
    lay(row('l1', '.layer-lock'))
    lay(row('l2'))
    lay(row('l2', '[title="Move down"]'))
    check('moving a layer down changes the sent order', [l['id'] for l in layers()] == ['l2', 'l1'] and sdj()['strokes'][0]['points'][0][1] > 500)
    sent_line, sent_ellipse = sdj()['strokes']
    check('the sent timeline replays the lower layer first although it was drawn later',
          ellipse['startOffset'] < S()[0]['startOffset'] and sent_ellipse['startOffset'] >= sent_line['startOffset'] + sent_line['points'][-1][2] + 400,
          (sent_line['startOffset'], sent_ellipse['startOffset']))
    lay(row('l2', '[title="Move up"]'))
    ui('#layerList')
    page.locator(row('l2', '[title=Rename]')).click()
    page.keyboard.press('Control+a'); page.keyboard.type('ink'); page.keyboard.press('Enter')
    close_pops()
    check('rename from the row', layers()[1]['name'] == 'ink', layers())
    page.keyboard.press('Control+z')
    check('rename is one undo step', layers()[1]['name'] == 'Layer 2')
    page.keyboard.press('Control+Shift+z')
    lay(row('l2', '[title=Duplicate]'))
    check('duplicate copies the layer and its strokes above', [l['name'] for l in layers()] == ['Layer 1', 'ink', 'ink copy'] and len(S()) == 3)
    lay(row(active(), '[title="Merge down"]'))
    check('merge down joins the copy into the layer below', [l['name'] for l in layers()] == ['Layer 1', 'ink'] and [s['layer'] for s in S()] == ['l1', 'l2', 'l2'])
    page.keyboard.press('Control+z'); page.keyboard.press('Control+z')
    check('layer operations undo with the strokes', len(layers()) == 2 and len(S()) == 2)
    lay(row('l2'))
    page.keyboard.press('s'); mouse_path([(60, 60), (440, 60), (440, 440), (60, 440)])
    check('the lasso picks the ellipse on another layer', halos() == 1 and S()[0]['layer'] == 'l1')
    page.keyboard.press('Control+c')
    page.keyboard.press('Control+d')
    check('duplicate puts the copy on the layer of the original, just above it', [s['layer'] for s in S()] == ['l1', 'l1', 'l2'] and active() == 'l2', [s['layer'] for s in S()])
    page.keyboard.press('Control+z')
    page.keyboard.press('Control+v')
    check('paste goes to the active layer', [s['layer'] for s in S()] == ['l1', 'l2', 'l2'], [s['layer'] for s in S()])
    page.keyboard.press('Control+z')
    page.keyboard.press('Escape'); page.keyboard.press('b')

    lay(row('l1', '.layer-visible'))
    act('#libName', 'fill', 'layered')
    act('#libSave')
    page.wait_for_timeout(200)
    ui('#libList')
    check('the library card shows what would be sent', '· 1 strokes' in page.locator('#libList .card').first.inner_text(), page.locator('#libList .card').first.inner_text())
    close_pops()
    page.wait_for_timeout(500)
    page.reload(); page.wait_for_timeout(500)
    check('layers survive a reload', [(l['name'], l['hidden']) for l in layers()] == [('Layer 1', True), ('ink', False)] and [s['layer'] for s in S()] == ['l1', 'l2'], layers())
    act('#clear')
    check('Clear leaves one empty layer', len(layers()) == 1 and len(S()) == 0)
    ui('#libList')
    page.locator('#libList .card').first.get_by_role('button', name='Open').click()
    close_pops()
    check('Open restores the saved layers', [(l['name'], l['hidden']) for l in layers()] == [('Layer 1', True), ('ink', False)] and len(S()) == 2, layers())
    item = {'id': 'layered-import', 'name': 'imported', 'savedAt': 1, 'layers': {'list': [{'id': 'l1', 'name': 'under', 'hidden': False, 'locked': True}, {'id': 'l3', 'name': 'over', 'hidden': False, 'locked': False}], 'active': 'l3', 'of': [1, 0]},
            'sdj': {'version': 1, 'canvas': {'width': 720, 'height': 960}, 'palette': {'black': {'light': '#222222', 'dark': '#F5F5F5'}},
                    'strokes': [{'color': 'black', 'weight': 3, 'startOffset': 0, 'points': [[10, 10, 0], [50, 50, 40]]}, {'color': 'black', 'weight': 3, 'startOffset': 100, 'points': [[60, 10, 0], [90, 50, 40]]}]}}
    (OUT / 'layered.json').write_text(json.dumps({'app': 'doodler', 'version': 1, 'items': [item]}))
    ui('#libImport').set_input_files(str(OUT / 'layered.json'))
    page.wait_for_timeout(300)
    page.locator('#libList .card', has_text='imported').get_by_role('button', name='Open').click()
    close_pops()
    check('a library import keeps the layers', [(l['name'], l['locked']) for l in layers()] == [('under', True), ('over', False)] and active() == 'l3' and [s['layer'] for s in S()] == ['l1', 'l3'], layers())
    act('#out', 'fill', json.dumps(item['sdj']))
    act('#load')
    check('a plain SDJ loads as one layer', [l['name'] for l in layers()] == ['Layer 1'] and len(S()) == 2)

    ui('#svgFile').set_input_files(str(OUT / 'shapes.svg'))
    page.wait_for_timeout(400)
    page.locator('#importColors').select_option('exact')
    page.wait_for_timeout(400)
    page.locator('#importDone').click()
    check('an SVG import lands on one new layer named after the file', [l['name'] for l in layers()] == ['Layer 1', 'shapes'] and all(s['layer'] == active() for s in S()[2:]), layers())
    act('#text', 'fill', 'Hi')
    act('#writeText')
    page.wait_for_timeout(300)
    page.locator('#importDone').click()
    check('text lands on a layer named after it', layers()[-1]['name'] == 'Hi' and active() == layers()[-1]['id'])
    page.evaluate('''(svg) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'doodler:import-svg', svg }, origin: 'https://web.slowly.app', source: window }))''', SVG)
    page.wait_for_timeout(500)
    bottom = layers()[0]['id']
    check('a Remix onto a drawing puts its Background at the bottom and keeps the active layer',
          [l['name'] for l in layers()] == ['Background', 'Layer 1', 'shapes', 'Hi'] and active() == layers()[-1]['id'] and any(s['layer'] == bottom for s in S()) and S()[0]['layer'] == bottom,
          ([l['name'] for l in layers()], active()))
    page.keyboard.press('Control+z')
    check('undo removes the Remix layer', [l['name'] for l in layers()] == ['Layer 1', 'shapes', 'Hi'])
    check('an SVG import still finds its shapes while the page waits for Slowly styles (body hidden)', page.evaluate('''async (svg) => {
      document.documentElement.classList.remove('styled');
      try { return (await __doodler.importSvg(svg, { remix: true })).polylines.length > 0; }
      catch { return false; }
      finally { document.documentElement.classList.add('styled'); }
    }''', SVG))
    for _ in range(7): act('#layerAdd')
    check('+ is disabled at 10 layers', len(layers()) == 10 and page.locator('#layerAdd').is_disabled())
    act('#layerAdd', 'click', force=True)
    check('the cap holds', len(layers()) == 10)
    top = active()
    def on_top(): return sum(s['layer'] == top for s in S())
    ui('#svgFile').set_input_files(str(OUT / 'shapes.svg'))
    page.wait_for_timeout(400)
    page.locator('#importDone').click()
    check('at the cap an import goes to the active layer', len(layers()) == 10 and on_top() > 0 and not import_bar(), (len(layers()), on_top()))
    page.keyboard.press('Control+z')
    close_pops()
    lay(row(top, '.layer-lock'))
    close_pops()
    ui('#svgFile').set_input_files(str(OUT / 'shapes.svg'))
    page.wait_for_timeout(400)
    page.locator('#importDone').click()
    check('at the cap with the active layer locked Done says there is no room and keeps the preview',
          'no room for another layer' in status() and import_bar() and len(preview()) > len(S()) and on_top() == 0 and len(layers()) == 10, status())
    page.keyboard.press('Escape')
    lay(row(top, '.layer-lock'))
    close_pops()
    check('Escape drops the preview the cap kept', not import_bar() and len(preview()) == len(S()))
    page.set_viewport_size({'width': 900, 'height': 700})
    def toast_on_top(pop):
        toast = page.locator('#toast').bounding_box()
        rect = page.locator(f'#{pop}').bounding_box()
        x0, x1 = max(toast['x'], rect['x']), min(toast['x'] + toast['width'], rect['x'] + rect['width'])
        y0, y1 = max(toast['y'], rect['y']), min(toast['y'] + toast['height'], rect['y'] + rect['height'])
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        over = x0 < x1 and y0 < y1
        top = page.evaluate('([x, y]) => { const t = document.getElementById("toast"); t.style.pointerEvents = "auto"; const hit = !!document.elementFromPoint(x, y)?.closest("#toast"); t.style.pointerEvents = ""; return hit; }', [cx, cy])
        return over and top
    ui('#libList')
    page.locator('#libList .card').first.get_by_role('button', name='Add').click()
    page.wait_for_timeout(100)
    check('a toast shows above an open popover', 'no room for another layer' in status() and toast_on_top('popGallery'), status())
    close_pops()
    ui('#layerList')
    page.wait_for_timeout(100)
    check('a toast already on screen stays above a popover opened after it', toast_on_top('popLayers'))
    close_pops()
    lay(row('l1', '.layer-visible'))
    lay(row('l2', '.layer-lock'))
    lay(row(layers()[-2]['id']))
    for theme in ('light', 'dark'):
        if theme == 'dark': act('#dark', 'check', force=True)
        for w, h in ((1280, 900), (900, 700)):
            page.set_viewport_size({'width': w, 'height': h})
            ui('#layerList')
            page.wait_for_timeout(150)
            if (theme, w) == ('light', 900):
                m = page.evaluate('''() => {
                  const list = document.getElementById('layerList'), pop = document.getElementById('popLayers'), rows = [...list.querySelectorAll('.layer-row')];
                  const inside = el => { const r = el.getBoundingClientRect(), b = list.getBoundingClientRect(); return r.top >= b.top - 1 && r.bottom <= b.bottom + 1; };
                  const i = rows.findIndex((r, k) => k > 0 && rows[k - 1].getAttribute('aria-selected') !== 'true' && r.getAttribute('aria-selected') !== 'true');
                  const activeShown = inside(list.querySelector('[aria-selected=true]'));
                  list.scrollTop = list.scrollHeight;
                  return { scrolls: list.scrollHeight > list.clientHeight, popFits: pop.scrollHeight <= pop.clientHeight, activeShown, lastReachable: inside(rows[rows.length - 1]),
                    pitch: rows[i].getBoundingClientRect().top - rows[i - 1].getBoundingClientRect().top, headShown: pop.getBoundingClientRect().top < list.getBoundingClientRect().top };
                }''')
                check('10 layers at 900x700 scroll inside the list, the bottom one is reachable and the panel head stays', m['scrolls'] and m['popFits'] and m['activeShown'] and m['lastReachable'] and m['headShown'] and 48 <= m['pitch'] <= 56, m)
            if w == 1280: page.locator(row(active(), '.layer-delete')).hover()
            page.screenshot(path=str(OUT / f'14-layers-{theme}-{w}{SUFFIX}.png'))
            close_pops()
    act('#dark', 'uncheck', force=True)

    page.set_viewport_size({'width': 1280, 'height': 900})
    item = {'id': 'many', 'name': 'many', 'savedAt': 2, 'layers': {'list': [{'id': 'l1', 'name': 'sketch', 'hidden': True, 'locked': False}, {'id': 'l2', 'name': 'ink', 'hidden': False, 'locked': False}], 'active': 'l2', 'of': [0] * 1000},
            'sdj': {'version': 1, 'canvas': {'width': 720, 'height': 960}, 'palette': {'black': {'light': '#222222', 'dark': '#F5F5F5'}},
                    'strokes': [{'color': 'black', 'weight': 3, 'startOffset': i * 100, 'points': [[10, 10, 0], [50, 50, 40]]} for i in range(1000)]}}
    (OUT / 'many.json').write_text(json.dumps({'app': 'doodler', 'version': 1, 'items': [item]}))
    ui('#libImport').set_input_files(str(OUT / 'many.json'))
    page.wait_for_timeout(300)
    page.locator('#libList .card', has_text='many').get_by_role('button', name='Open').click()
    close_pops()
    pen([(300, 300), (500, 400)])
    page.keyboard.press('s'); mouse_path([(250, 250), (550, 250), (550, 450), (250, 450)])
    page.keyboard.press('Control+d')
    check('the paste limit counts the strokes that would be sent, not hidden ones', len(S()) == 1002 and 'cannot paste' not in status(), (len(S()), status()))
    b.close()

print('errors', errors)
