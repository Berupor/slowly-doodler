import io, json, math, pathlib, subprocess, tempfile, urllib.parse
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).parent.parent
DOCS = ROOT / 'docs'
ART = DOCS / 'art' / 'girl-and-cat.jpg'
EXTENSION = ROOT / 'extension'
SLOWLY_CSS = ROOT / 'unsynced' / 'slowly' / 'css'
ORIGIN = 'https://web.slowly.app'
VIEWPORT = {'width': 1400, 'height': 1100}
SCROLL_TO_DRAWING = 420
PETALS = 8
STEPS = 14
HEART_STEPS = 24
REMIX_WAIT_TRIES = 20
GIF_HEIGHT = 640
FLOW_WIDTH = 900
REPLAY_FRAMES = 70
PHOTO_SLIDERS = {'importDetail': '60', 'importWeight': '1'}
HEARTS = [(0.80, 0.20, 0.07), (0.90, 0.30, 0.045), (0.14, 0.24, 0.055)]
BLUSH = [(0.43, 0.335), (0.575, 0.335)]
POP_BUTTONS = {'popGallery': '#galleryBtn', 'popInsert': '#insertBtn', 'popMore': '#moreBtn', 'popReplay': '#replay', 'popGuides': '#guidesBtn', 'popColor': '#colorBtn',
               'popBrush': '[data-tool=pen]', 'popEraser': '[data-tool=eraser]', 'popFill': '[data-tool=fill]'}

SET_SLIDER_JS = '(e, v) => { e.value = v; e.dispatchEvent(new Event("input")); }'


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


def open_slowly(p, profile, drawing):
    html = (DOCS / 'slowly-fixture.html').read_text().replace('{{DRAWING}}', drawing)

    def route(r):
        path = urllib.parse.urlparse(r.request.url).path
        if path == '/static/css/main.css': return r.fulfill(path=str(SLOWLY_CSS / 'main.css'), content_type='text/css')
        if path == '/static/css/icomoon.ttf': return r.fulfill(path=str(SLOWLY_CSS / 'icomoon.ttf'), content_type='font/ttf')
        r.fulfill(body=html, content_type='text/html')

    ctx = p.chromium.launch_persistent_context(
        str(profile), channel='chromium', headless=True, viewport=VIEWPORT,
        args=[f'--disable-extensions-except={EXTENSION}', f'--load-extension={EXTENSION}'])
    ctx.route(f'{ORIGIN}/**', route)
    page = ctx.new_page()
    page.goto(ORIGIN + '/')
    page.wait_for_timeout(1500)
    return ctx, page


def import_photo(ed, page, path):
    ed.locator('#insertBtn').click()
    ed.locator('#photoFile').set_input_files(str(path))
    page.wait_for_timeout(1500)
    ed.locator('#importPreset').select_option('detailed')
    ed.locator('#importColors').select_option('snap')
    for id, value in PHOTO_SLIDERS.items():
        ed.locator(f'#{id}').evaluate(SET_SLIDER_JS, value)
    page.wait_for_timeout(2500)


def trace(p, work):
    ctx, page = open_slowly(p, work / 'trace', '')
    page.locator('.composer-actions .icon-drawing').click()
    page.wait_for_timeout(1500)
    ed = page.frame_locator('iframe')
    import_photo(ed, page, ART)
    ed.locator('#importDone').click()
    ed.locator('#send').click()
    page.wait_for_selector('.drawing-thumbnail:not([hidden])', timeout=15000)
    src = page.locator('.drawing-thumbnail img').get_attribute('src')
    ctx.close()
    return src


def run():
    work = pathlib.Path(tempfile.mkdtemp())

    with sync_playwright() as p:
        drawing = trace(p, work)
        ctx, page = open_slowly(p, work / 'profile', drawing)
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

        def editor():
            return page.locator('iframe').bounding_box()

        def close_pops():
            ed.locator('body').evaluate('() => document.querySelectorAll(":popover-open").forEach(p => p.hidePopover())')

        def ui(sel):
            pop = ed.locator('body').evaluate('(_, s) => { const el = document.querySelector(s); el.closest("details")?.setAttribute("open", ""); return el.closest("[popover]")?.id ?? null; }', sel)
            if pop and ed.locator(f'#{pop}:popover-open').count() == 0:
                close_pops()
                button = ed.locator(POP_BUTTONS[pop])
                if pop == 'popReplay':
                    button.click(button='right')
                    ed.locator('#popReplay').wait_for()
                else:
                    if button.get_attribute('aria-pressed') == 'false': button.click()
                    button.click()
            if ed.locator('body').evaluate('(_, s) => !!document.querySelector(s).closest("#textPanel")', sel) and ed.locator('#textPanel').is_hidden(): ed.locator('#insertTextBtn').click()
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
            clip = editor()
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
                    if k % 2 == 0: shot('kaleido', clip)
                page.mouse.up()
                shot('kaleido', clip)
            page.wait_for_timeout(200)

        def stroke(points, every=0):
            page.mouse.move(*points[0])
            page.mouse.down()
            for k, pt in enumerate(points[1:], 1):
                page.mouse.move(*pt)
                if every and k % every == 0: shot('flow')
            page.mouse.up()

        def heart(cx, cy, r):
            ts = [2 * math.pi * k / HEART_STEPS for k in range(HEART_STEPS + 1)]
            return [(cx + r * math.sin(t) ** 3, cy - r * (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 16) for t in ts]

        def doodle():
            board = ed.locator('#paper').bounding_box()
            at = lambda fx, fy: (board['x'] + fx * board['width'], board['y'] + fy * board['width'] * 4 / 3)
            ed.locator('[data-tool=pen]').click()
            act('#colors [title=pink]')
            for fx, fy, size in HEARTS:
                cx, cy = at(fx, fy)
                stroke(heart(cx, cy, size * board['width']), 4)
            for fx, fy in BLUSH:
                cx, cy = at(fx, fy)
                for dx in (-12, 0, 12):
                    stroke([(cx + dx - 4, cy + 8), (cx + dx + 4, cy - 8)])
                shot('flow')

        def reopen():
            page.locator('.composer-actions .icon-drawing').click()
            page.wait_for_timeout(1200)

        def replay():
            act('#replaySpeed', 'select_option', '1')
            act('#out', 'scroll_into_view_if_needed')
            page.wait_for_timeout(300)
            sdj = json.loads(ed.locator('#out').input_value())['sdj']
            for _ in range(REMIX_WAIT_TRIES):
                if sdj['strokes']: break
                page.wait_for_timeout(500)
                sdj = json.loads(ed.locator('#out').input_value())['sdj']
            else:
                page.screenshot(path='/tmp/remix-empty.png')
                raise RuntimeError('remix produced no strokes')
            step = round(end_time(sdj) / REPLAY_FRAMES)
            clip = editor()
            page.clock.install()
            ed.locator('#replay').click()
            for _ in range(REPLAY_FRAMES * 2):
                page.clock.run_for(step)
                shot('scene', clip)
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
        replay()
        doodle()
        hold('flow', 2)
        save('Remix')

        ed.locator('#send').click()
        page.wait_for_selector('.drawing-thumbnail:not([hidden])', timeout=15000)
        for _ in range(4):
            page.wait_for_timeout(250)
            shot('flow')
        page.screenshot(path=str(DOCS / 'attached.png'))
        hold('flow', 3)
        page.wait_for_selector('.toast', state='detached', timeout=15000)

        reopen()
        act('#clear')
        import_photo(ed, page, ART)
        ed.locator('#importDone').click()
        ed.locator('[data-tool=pen]').click()
        ed.locator('#toast.shown').wait_for(state='detached')
        before_after(ART, ed.locator('#paper').screenshot(), DOCS / 'photo.png')
        save('Girl and cat')

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

        ed.locator('body').press('Escape')
        page.wait_for_timeout(500)
        page.evaluate('document.documentElement.classList.add("theme-dark")')
        reopen()
        ed.locator('#galleryBtn').click()
        ed.locator('#toast.shown').wait_for(state='detached')
        page.screenshot(path=str(DOCS / 'library.png'))
        ctx.close()

        gif(work / 'kaleido', 'draw.gif', 15)
        gif(work / 'scene', 'scene.gif', 12)
        gif(work / 'flow', 'flow.gif', 4, FLOW_WIDTH)
        print('frames', frames)


run()
