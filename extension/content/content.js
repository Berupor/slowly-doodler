(() => {
  const PENDING = 'doodler:pending';
  const SVG_DATA = 'data:image/svg+xml';
  const SAVE_TIMEOUT_MS = 20000;
  // Slowly restores and saves a drawing stroke by stroke, so every wait grows with the point count
  const MS_PER_POINT = 0.2;
  const pageUrl = chrome.runtime.getURL('editor/index.html');
  const origin = new URL(pageUrl).origin;
  // web.slowly.app main.*.js markup; when their bundle changes, these are the strings to update
  const SLOWLY = {
    opener: 'button.btn-toolbar i.icon-drawing',
    replyPill: 'button.rounded-pill i.icon-pencil',
    thumbnail: '.drawing-thumbnail-preview',
    thumbnailImage: '.drawing-thumbnail-preview img',
    thumbnailEdit: '.drawing-thumbnail-edit',
    editor: '.drawing-dialog',
    editorDone: '.drawing-dialog .drawing-done',
    editorWarning: '.drawing-dialog .alert-warning',
    restoreConfirm: '.modal-footer .btn-primary',
    stylesheetPath: '/static/css/',
    composer: '.composer-actions',
    thumbnailBox: '.drawing-thumbnail',
  };
  // where the anchor is on screen, every `expect` selector must be too. The native editor's selectors are left to
  // attach(): that modal shows a loading state first, so absence there is not proof
  /** @type {{ anchor: string, expect: (keyof typeof SLOWLY)[] }[]} */
  const MARKUP = [
    { anchor: SLOWLY.composer, expect: ['opener'] },
    { anchor: SLOWLY.thumbnailBox, expect: ['thumbnail', 'thumbnailEdit'] },
  ];
  const MARKUP_WARNED = 'doodler:markup-warned';
  const SETTLE_MS = 2000;
  /** @type {HTMLDivElement | null} */
  let overlay = null;
  /** @type {HTMLIFrameElement | null} */
  let frame = null;
  /** @type {object[]} */
  let queued = [];
  let ready = false, nativeClick = false;

  /** @template {HTMLElement} T @param {T} el @param {string} text */
  const css = (el, text) => { el.style.cssText = text; return el; };
  const isDark = () => document.documentElement.classList.contains('theme-dark');

  /** @returns {HTMLButtonElement | null} */
  const findOpener = () => document.querySelector(SLOWLY.opener)?.closest('button') ?? null;
  const attachedSvg = () => {
    const src = document.querySelector(SLOWLY.thumbnailImage)?.getAttribute('src');
    return src?.startsWith(SVG_DATA) ? decodeSvg(src) : null;
  };

  class SelectorMissing extends Error {
    /** @param {keyof typeof SLOWLY} name @param {string} message */
    constructor(name, message) {
      super(message);
      this.selector = SLOWLY[name];
    }
  }

  document.addEventListener('click', e => {
    if (nativeClick || e.shiftKey || !(e.target instanceof Element)) return;
    const opener = e.target.closest('button');
    if (!opener || !(opener.matches(SLOWLY.thumbnailEdit) || opener === findOpener())) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    open();
    const svg = attachedSvg();
    if (svg) post({ type: 'doodler:import-svg', svg, replace: true });
  }, true);

  function slowlyButton(className, icon, label, style) {
    const b = css(document.createElement('button'), style);
    b.className = `btn btn-secondary rounded-pill shadow-sm ${className}`;
    const i = document.createElement('i');
    i.className = `icon-${icon}`;
    b.append(i, ` ${label}`);
    return b;
  }

  const remix = slowlyButton('btn-sm', 'pencil', 'Remix', 'position:fixed;z-index:2147483646;display:none;font-weight:600');
  const save = slowlyButton('btn-sm', 'download', 'Save', 'position:fixed;z-index:2147483646;display:none;font-weight:600');
  document.body.append(save, remix);
  /** @type {HTMLImageElement | null} */
  let remixTarget = null;
  let saving = false;

  const BUTTON_MARGIN = 8;
  const BUTTON_GAP = 6;
  const HIDE_DELAY_MS = 200;
  let hideTimer = 0;
  const inHoverZone = (/** @type {EventTarget | null} */ el) => !!el && (el === remixTarget || el === remix || el === save);
  const buttonsShown = () => remix.style.display === 'block';
  const hideButtons = () => { remix.style.display = save.style.display = 'none'; };

  function placeButtons() {
    if (!remixTarget) return;
    const r = remixTarget.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return hideButtons();
    const top = `${Math.max(r.top, 0) + BUTTON_MARGIN}px`;
    const left = Math.min(r.right, innerWidth) - remix.offsetWidth - BUTTON_MARGIN;
    Object.assign(remix.style, { left: `${left}px`, top });
    Object.assign(save.style, { left: `${left - save.offsetWidth - BUTTON_GAP}px`, top });
  }

  document.addEventListener('mouseover', e => {
    if (!(e.target instanceof Element)) return;
    if (inHoverZone(e.target)) clearTimeout(hideTimer);
    const img = /** @type {HTMLImageElement | null} */ (e.target.closest(`img[src^="${SVG_DATA}"]`));
    if (!img || overlay || img.closest(SLOWLY.thumbnail)) return;
    if (img.getBoundingClientRect().width < 60 || saving) return;
    clearTimeout(hideTimer);
    remixTarget = img;
    remix.style.display = save.style.display = 'block';
    placeButtons();
  });
  document.addEventListener('mouseout', e => {
    if (saving || !inHoverZone(e.target) || inHoverZone(e.relatedTarget)) return;
    hideTimer = setTimeout(hideButtons, HIDE_DELAY_MS);
  });
  const replaceButtons = () => { if (buttonsShown()) placeButtons(); };
  addEventListener('scroll', replaceButtons, { capture: true, passive: true });
  addEventListener('resize', replaceButtons);
  remix.onclick = () => {
    if (!remixTarget) return;
    hideButtons();
    open();
    post({ type: 'doodler:import-svg', svg: decodeSvg(remixTarget.getAttribute('src') ?? '') });
  };

  /** @param {string} name */
  const editorModule = name => import(chrome.runtime.getURL(`editor/${name}.js`));

  /** @param {string} svg @returns {Promise<number>} dropped pieces */
  async function saveToLibrary(svg) {
    const [S, svgImport, library] = await Promise.all([editorModule('sdj'), editorModule('import-svg'), editorModule('library')]);
    const { polylines, palette, dropped } = await svgImport.importSvg(svg, { remix: true });
    const sdj = S.buildSdj(S.timed(polylines, 0), palette);
    const invalid = S.validate(sdj);
    if (invalid) throw new Error(invalid);
    const { friends, current } = doodlerFriends();
    const friend = friends.find(f => f.userId === current)?.name;
    const stamp = new Date().toLocaleString();
    await library.saveDrawing(friend ? `${friend}, ${stamp}` : stamp, sdj);
    return dropped;
  }

  save.onclick = async () => {
    if (!remixTarget || saving) return;
    const svg = decodeSvg(remixTarget.getAttribute('src') ?? '');
    const label = /** @type {ChildNode} */ (save.lastChild);
    saving = save.disabled = true;
    label.textContent = ' Saving...';
    try {
      const dropped = await saveToLibrary(svg);
      toast(dropped ? `Saved to Doodler library, ${dropped} smallest pieces dropped` : 'Saved to Doodler library');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error('doodler_save_failed', { reason });
      toast(`Could not save the drawing (${reason}).`);
    } finally {
      saving = save.disabled = false;
      label.textContent = ' Save';
      hideButtons();
    }
  };

  /** @param {string} src */
  function decodeSvg(src) { return decodeURIComponent(src.slice(src.indexOf(',') + 1)); }

  /** @param {object} msg */
  function post(msg) {
    if (ready && frame?.contentWindow) frame.contentWindow.postMessage(msg, origin);
    else queued.push(msg);
  }

  /** @returns {string[]} */
  function slowlyStylesheets() {
    const hrefs = [];
    for (const link of document.querySelectorAll('link[rel=stylesheet]')) {
      const href = new URL(/** @type {HTMLLinkElement} */ (link).href);
      if (href.origin === location.origin && href.pathname.startsWith(SLOWLY.stylesheetPath)) hrefs.push(href.href);
    }
    return hrefs;
  }

  function frameUrl() {
    const url = new URL(pageUrl);
    for (const href of slowlyStylesheets()) url.searchParams.append('css', href);
    if (isDark()) url.searchParams.set('theme', 'dark');
    return url.href;
  }

  function open() {
    if (overlay) return;
    ready = false;
    queued = [{ type: 'doodler:friends', ...doodlerFriends() }];
    const backdrop = css(document.createElement('div'),
      'position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.5);backdrop-filter:blur(2px);'
      + 'display:grid;place-items:center');
    backdrop.onclick = e => { if (e.target === backdrop) close(); };
    const iframe = css(document.createElement('iframe'),
      `width:min(1280px,96vw);height:min(900px,94vh);border:0;border-radius:12px;background:${isDark() ? '#1b1d24' : '#f8f8f8'};`
      + 'box-shadow:0 20px 60px rgba(0,0,0,.35)');
    iframe.src = frameUrl();
    backdrop.appendChild(iframe);
    document.body.appendChild(backdrop);
    overlay = backdrop;
    frame = iframe;
    document.addEventListener('keydown', escClose);
  }

  function close() {
    overlay?.remove();
    overlay = frame = null;
    ready = false;
    queued = [];
    document.removeEventListener('keydown', escClose);
  }

  /** @param {KeyboardEvent} e */
  function escClose(e) { if (e.key === 'Escape') close(); }

  /** @param {string} text @param {number} [ms] Infinity keeps the toast until it is removed */
  function toast(text, ms = 7000) {
    const t = css(document.createElement('div'),
      'position:fixed;right:18px;bottom:84px;z-index:2147483646;padding:12px 16px;border-radius:12px');
    t.className = 'toast show shadow-sm';
    t.textContent = text;
    document.body.appendChild(t);
    if (Number.isFinite(ms)) setTimeout(() => t.remove(), ms);
    return t;
  }

  /** @template T @param {() => T} check @param {number} ms @returns {Promise<T>} */
  function waitFor(check, ms) {
    return new Promise(resolve => {
      const until = Date.now() + ms;
      const tick = () => {
        const v = check();
        if (v || Date.now() > until) return resolve(v);
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  function hideNativeEditor() {
    const style = document.createElement('style');
    style.textContent = '.modal, .modal-backdrop { opacity: 0 !important; }';
    document.head.appendChild(style);
    return () => style.remove();
  }

  /** @param {{ strokes: { points: unknown[] }[] }} sdj */
  async function attach(sdj) {
    if (document.querySelector(SLOWLY.editor))
      return toast('Close the open Slowly drawing editor first, then send again.');
    if (!findOpener()) document.querySelector(SLOWLY.replyPill)?.closest('button')?.click();
    const opener = await waitFor(findOpener, 3000);
    if (!opener || opener.disabled) return toast('Open a letter to reply to, then send the drawing again.');
    const points = sdj.strokes.reduce((n, s) => n + s.points.length, 0);
    const budget = (/** @type {number} */ ms) => ms + Math.round(points * MS_PER_POINT);
    const show = hideNativeEditor();
    const busy = toast('Attaching the drawing to your letter...', Infinity);
    try {
      localStorage.setItem(PENDING, JSON.stringify(sdj));
      nativeClick = true;
      opener.click();
      nativeClick = false;
      if (!await waitFor(() => !localStorage.getItem(PENDING), budget(5000))) throw new Error('the editor did not pick the drawing up');
      const confirm = await waitFor(() => /** @type {HTMLElement | undefined} */ ([...document.querySelectorAll(SLOWLY.restoreConfirm)].pop()), budget(3000));
      if (!confirm) throw new SelectorMissing('restoreConfirm', 'no restore prompt');
      confirm.click();
      const done = await waitFor(() => {
        const b = /** @type {HTMLButtonElement | null} */ (document.querySelector(SLOWLY.editorDone));
        return b && !b.disabled && b;
      }, budget(3000));
      if (!done) throw new SelectorMissing('editorDone', 'save button not ready');
      done.click();
      const closed = await waitFor(() => !document.querySelector(SLOWLY.editor)
        || document.querySelector(SLOWLY.editorWarning), budget(SAVE_TIMEOUT_MS));
      if (!closed || document.querySelector(SLOWLY.editor)) throw new Error('saving failed');
      busy.remove();
      show();
      toast('Drawing attached to your letter.');
    } catch (err) {
      nativeClick = false;
      localStorage.removeItem(PENDING);
      busy.remove();
      show();
      const reason = err instanceof Error ? err.message : String(err);
      if (err instanceof SelectorMissing) console.error('doodler_selector_missing', { selector: err.selector, reason });
      else console.error('doodler_attach_failed', { reason });
      toast(`Could not attach automatically (${reason}). Finish in the Slowly editor.`);
    }
  }

  /** @type {Map<keyof typeof SLOWLY, number>} */
  const suspects = new Map();
  let scanTimer = 0;

  // missing counts only when the anchor is on screen and the element stays absent for SETTLE_MS: the SPA renders in steps
  function scanMarkup() {
    scanTimer = 0;
    /** @type {[keyof typeof SLOWLY, string | undefined][]} */
    const missing = [];
    if (document.readyState === 'complete' && !slowlyStylesheets().length) missing.push(['stylesheetPath', undefined]);
    for (const { anchor, expect } of MARKUP)
      if (document.querySelector(anchor))
        for (const name of expect) if (!document.querySelector(SLOWLY[name])) missing.push([name, anchor]);
    const now = Date.now();
    for (const name of suspects.keys()) if (!missing.some(m => m[0] === name)) suspects.delete(name);
    for (const [name] of missing) if (!suspects.has(name)) suspects.set(name, now);
    const due = missing.filter(([name]) => now - (suspects.get(name) ?? now) >= SETTLE_MS);
    if (due.length) {
      for (const [name, anchor] of due) console.error('doodler_selector_missing', { selector: SLOWLY[name], anchor });
      toast('Slowly changed its page, Doodler may not attach drawings. Copy the JSON from the JSON tab as a fallback.', 20000);
      sessionStorage.setItem(MARKUP_WARNED, '1');
      markupObserver.disconnect();
    } else if (suspects.size) scanTimer = window.setTimeout(scanMarkup, SETTLE_MS + 100);
  }

  const scheduleScan = () => { if (!scanTimer) scanTimer = window.setTimeout(scanMarkup, 1000); };
  const markupObserver = new MutationObserver(scheduleScan);
  if (!sessionStorage.getItem(MARKUP_WARNED)) {
    markupObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('load', scheduleScan);
    scheduleScan();
  }

  window.addEventListener('message', e => {
    if (e.origin !== origin || !frame || e.source !== frame.contentWindow) return;
    if (e.data?.type === 'doodler:ready') {
      ready = true;
      const pending = queued;
      queued = [];
      pending.forEach(post);
    } else if (e.data?.type === 'doodler:close') {
      close();
    } else if (e.data?.type === 'doodler:sdj') {
      close();
      attach(e.data.sdj);
    }
  });
})();
