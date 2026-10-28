import base64, io, json, math, pathlib, random, subprocess, tempfile, urllib.parse
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).parent.parent
DOCS = ROOT / 'docs'
EXTENSION = ROOT / 'extension'
SLOWLY_CSS = ROOT / 'unsynced' / 'slowly' / 'css'
ORIGIN = 'https://web.slowly.app'
VIEWPORT = {'width': 1400, 'height': 1100}
SCROLL_TO_DRAWING = 420
PETALS = 8
STEPS = 14
GIF_HEIGHT = 640
FLOW_WIDTH = 900
REPLAY_FRAMES = 70
PHOTO_SLIDERS = {'importDetail': '60', 'importWeight': '1'}
POP_BUTTONS = {'popGallery': '#galleryBtn', 'popInsert': '#insertBtn', 'popActions': '#actionsBtn', 'popGuides': '#guidesBtn', 'popColor': '#colorBtn',
               'popBrush': '[data-tool=pen]', 'popEraser': '[data-tool=eraser]', 'popFill': '[data-tool=fill]'}
BUILDING_STROKES = ['#8e24aa', '#1e88e5', '#0abab5', '#f06292', '#e53935']
BASELINE = 720
WINDOW = (14, 18)
WINDOW_PITCH = (26, 36)

RASTERIZE_JS = '''async (svg) => {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas'); c.width = 600; c.height = 800;
  c.getContext('2d').drawImage(img, 0, 0, 600, 800);
  return c.toDataURL('image/png').split(',')[1];
}'''


def city(filled):
    rnd = random.Random(7)
    out = ['<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">']
    if filled:
        out.append('<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1b4d"/><stop offset="1" stop-color="#6a4c93"/></linearGradient></defs>')
        out.append('<rect width="600" height="800" fill="url(#s)"/>')
        out.append('<circle cx="460" cy="130" r="55" fill="#fff3c4"/>')
    else:
        out.append('<rect width="600" height="800" fill="#ffffff"/>')
        out.append('<circle cx="460" cy="130" r="55" fill="none" stroke="#fb8c00" stroke-width="4"/>')
        out.append('<g fill="none" stroke="#fb8c00" stroke-width="3"><circle cx="440" cy="115" r="9"/><circle cx="478" cy="150" r="12"/><circle cx="472" cy="102" r="5"/></g>')
    for _ in range(22):
        x, y = rnd.randint(20, 580), rnd.randint(20, 240)
        if math.hypot(x - 460, y - 130) < 80: continue
        if filled: out.append(f'<circle cx="{x}" cy="{y}" r="2" fill="#ffffff"/>')
        else: out.append(f'<path d="M{x - 5} {y} H {x + 5} M{x} {y - 5} V {y + 5}" stroke="#fdd835" stroke-width="3" fill="none"/>')
    for _ in range(8):
        x, y = rnd.randint(40, 340), rnd.randint(190, 270)
        stroke = '#ffffff' if filled else '#222222'
        out.append(f'<path d="M{x} {y} Q {x + 8} {y - 12} {x + 16} {y} Q {x + 24} {y - 12} {x + 32} {y}" fill="none" stroke="{stroke}" stroke-width="3"/>')
    x = 0
    n = 0
    while x < 600:
        w = min(rnd.randint(52, 92), 600 - x)
        h = rnd.randint(190, 400)
        y = BASELINE - h
        color = BUILDING_STROKES[n % len(BUILDING_STROKES)]
        if filled: out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#1d2440"/>')
        else: out.append(f'<rect x="{x + 2}" y="{y}" width="{w - 4}" height="{h}" fill="none" stroke="{color}" stroke-width="4"/>')
        roof = rnd.choice(['flat', 'antenna', 'tank'])
        roof_stroke = '#1d2440' if filled else color
        if roof == 'antenna': out.append(f'<path d="M{x + w // 2} {y} V {y - 34}" stroke="{roof_stroke}" stroke-width="4" fill="none"/>')
        if roof == 'tank': out.append(f'<rect x="{x + 12}" y="{y - 18}" width="22" height="18" fill="{"#1d2440" if filled else "none"}" stroke="{roof_stroke}" stroke-width="4"/>')
        for r in range((h - 20) // WINDOW_PITCH[1]):
            for c in range((w - 14) // WINDOW_PITCH[0]):
                if rnd.random() > 0.55: continue
                wx, wy = x + 10 + c * WINDOW_PITCH[0], y + 12 + r * WINDOW_PITCH[1]
                if filled: out.append(f'<rect x="{wx}" y="{wy}" width="{WINDOW[0]}" height="{WINDOW[1]}" fill="#ffd966"/>')
                else: out.append(f'<rect x="{wx}" y="{wy}" width="{WINDOW[0]}" height="{WINDOW[1]}" fill="none" stroke="#fdd835" stroke-width="3"/>')
        x += w
        n += 1
    road = '#9e9e9e' if not filled else '#3a3a4a'
    out.append(f'<path d="M0 {BASELINE} H 600 M0 {BASELINE + 28} H 600" stroke="{road}" stroke-width="4" fill="none"/>')
    for dash in range(10, 600, 60):
        out.append(f'<path d="M{dash} {BASELINE + 54} h 30" stroke="{road}" stroke-width="4" fill="none"/>')
    out.append('</svg>')
    return '\n'.join(out)


def before_after(source, board_png, out):
    gap = 32
    board = Image.open(io.BytesIO(board_png)).convert('RGB')
    src = Image.open(source).convert('RGB')
    src = src.resize((round(src.width * board.height / src.height), board.height), Image.LANCZOS)
    sheet = Image.new('RGB', (src.width + gap + board.width, board.height), 'white')
    sheet.paste(src, (0, 0))
    sheet.paste(board, (src.width + gap, 0))
    sheet.save(out)


def gif(frames_dir, name, fps, width=None):
    scale = f'scale={width}:-1' if width else f'scale=-1:{GIF_HEIGHT}'
    subprocess.run([
        'ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps), '-i', f'{frames_dir}/f%03d.png',
        '-vf', f'{scale}:flags=lanczos,tpad=stop_mode=clone:stop_duration=2,split[a][b];[a]palettegen[p];[b][p]paletteuse',
        str(DOCS / name),
    ], check=True)


def end_time(sdj):
    return max(s['startOffset'] + (s['points'][-1][2] if s['points'] else 0) for s in sdj['strokes'])


def run():
    work = pathlib.Path(tempfile.mkdtemp())
    drawing = 'data:image/svg+xml,' + urllib.parse.quote(city(False))
    html = (DOCS / 'slowly-fixture.html').read_text().replace('{{DRAWING}}', drawing)

    def route(r):
        path = urllib.parse.urlparse(r.request.url).path
        if path == '/static/css/main.css': return r.fulfill(path=str(SLOWLY_CSS / 'main.css'), content_type='text/css')
        if path == '/static/css/icomoon.ttf': return r.fulfill(path=str(SLOWLY_CSS / 'icomoon.ttf'), content_type='font/ttf')
        r.fulfill(body=html, content_type='text/html')

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(work / 'profile'), channel='chromium', headless=True, viewport=VIEWPORT,
            args=[f'--disable-extensions-except={EXTENSION}', f'--load-extension={EXTENSION}'])
        ctx.route(f'{ORIGIN}/**', route)
        page = ctx.new_page()
        page.goto(ORIGIN + '/')
        page.wait_for_timeout(1500)
        ed = page.frame_locator('iframe')
        frames = {}

        def shot(kind, clip=None):
            d = work / kind
            d.mkdir(exist_ok=True)
            n = frames.get(kind, 0)
            page.screenshot(path=f'{d}/f{n:03d}.png', clip=clip)
            frames[kind] = n + 1

        def hold(kind, count, clip=None):
            for _ in range(count): shot(kind, clip)

        def stage():
            return ed.locator('.stage').bounding_box()

        def close_pops():
            ed.locator('body').evaluate('() => document.querySelectorAll(":popover-open").forEach(p => p.hidePopover())')

        def ui(sel):
            pop, tab = ed.locator('body').evaluate('(_, s) => { const el = document.querySelector(s); return [el.closest("[popover]")?.id ?? null, el.closest("[data-panel]")?.dataset.panel ?? null]; }', sel)
            if pop and ed.locator(f'#{pop}:popover-open').count() == 0:
                close_pops()
                button = ed.locator(POP_BUTTONS[pop])
                if button.get_attribute('aria-pressed') == 'false': button.click()
                button.click()
            if tab: ed.locator(f'[data-tab={tab}]').click()
            return ed.locator(sel)

        def act(sel, method='click', *args, **kw):
            getattr(ui(sel), method)(*args, **kw)
            close_pops()

        def save(name):
            ui('#libName').fill(name)
            act('#libSave')
            page.wait_for_timeout(300)

        def kaleido():
            board = ed.locator('#board').bounding_box()
            cx, cy, unit = board['x'] + board['width'] / 2, board['y'] + board['height'] / 2, board['width'] / 720
            act('#symmetry', 'select_option', label='Kaleido 12')
            act('#rainbow', 'check', force=True)
            clip = stage()
            shot('kaleido', clip)
            for i in range(PETALS):
                a0 = i * 2 * math.pi / PETALS / 6
                pts = []
                for k in range(STEPS + 1):
                    t = k / STEPS
                    r = (30 + 230 * t) * unit
                    a = a0 + 0.9 * math.sin(t * math.pi) + 0.5 * t
                    pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
                page.mouse.move(*pts[0])
                page.mouse.down()
                for k, pt in enumerate(pts[1:], 1):
                    page.mouse.move(*pt)
                    if k % 2 == 0:
                        shot('kaleido', clip)
                        if i % 2 == 0 and k == STEPS: shot('flow')
                page.mouse.up()
                shot('kaleido', clip)
            page.wait_for_timeout(200)

        def replay():
            act('#replaySpeed', 'select_option', '1')
            sdj = json.loads(ed.locator('#out').input_value())['sdj']
            step = round(end_time(sdj) / REPLAY_FRAMES)
            clip = stage()
            page.clock.install()
            ed.locator('#replay').click()
            for _ in range(REPLAY_FRAMES * 2):
                page.clock.run_for(step)
                shot('city', clip)
                if ed.locator('#replay i').get_attribute('data-glyph') == '▶': break
            page.clock.resume()

        page.mouse.move(800, 300)
        page.mouse.wheel(0, SCROLL_TO_DRAWING)
        page.wait_for_timeout(300)
        page.mouse.move(800, 380)
        page.wait_for_timeout(400)
        hold('flow', 3)
        page.screenshot(path=str(DOCS / 'hover.png'))

        page.get_by_role('button', name='Remix').click()
        page.wait_for_timeout(2500)
        hold('flow', 3)
        page.screenshot(path=str(DOCS / 'remix.png'))
        replay()

        act('#clear')
        source = work / 'city.png'
        source.write_bytes(base64.b64decode(page.evaluate(RASTERIZE_JS, city(True))))
        ui('#photoFile').set_input_files(str(source))
        page.wait_for_timeout(1500)
        ed.locator('#importPreset').select_option('detailed')
        ed.locator('#importColors').select_option('snap')
        for id, value in PHOTO_SLIDERS.items():
            ed.locator(f'#{id}').evaluate('(e, v) => { e.value = v; e.dispatchEvent(new Event("input")); }', value)
        page.wait_for_timeout(2500)
        ed.locator('#importDone').click()
        ed.locator('[data-tool=pen]').click()
        before_after(source, ed.locator('#board').screenshot(), DOCS / 'photo.png')
        save('City image')

        act('#clear')
        ui('#text').fill('Hello from far away, dear friend!')
        act('#writeText')
        page.wait_for_timeout(800)
        ed.locator('#importDone').click()
        save('Letter')

        act('#clear')
        kaleido()
        act('#rainbow', 'uncheck', force=True)
        act('#symmetry', 'select_option', 'off')
        save('Kaleido')
        hold('flow', 3)

        ed.locator('#send').click()
        page.wait_for_selector('.drawing-thumbnail:not([hidden])', timeout=15000)
        for _ in range(8):
            page.wait_for_timeout(250)
            shot('flow')
        page.screenshot(path=str(DOCS / 'attached.png'))
        hold('flow', 6)

        page.wait_for_selector('.toast', state='detached', timeout=15000)
        page.evaluate('document.documentElement.classList.add("theme-dark")')
        page.locator('.composer-actions .icon-drawing').click()
        page.wait_for_timeout(1200)
        ed.locator('#galleryBtn').click()
        page.wait_for_timeout(300)
        page.screenshot(path=str(DOCS / 'library.png'))
        ctx.close()

        gif(work / 'kaleido', 'draw.gif', 15)
        gif(work / 'city', 'scene.gif', 12)
        gif(work / 'flow', 'flow.gif', 4, FLOW_WIDTH)
        print('frames', frames)


run()
