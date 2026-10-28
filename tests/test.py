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
    b.close()

print('errors', errors)
