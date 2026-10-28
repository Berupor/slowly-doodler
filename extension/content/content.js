(() => {
  const PENDING = 'doodler:pending';
  const SVG_DATA = 'data:image/svg+xml';
  const SAVE_TIMEOUT_MS = 20000;
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
  };
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
  document.body.appendChild(remix);
  /** @type {HTMLImageElement | null} */
  let remixTarget = null;

  document.addEventListener('mouseover', e => {
    if (!(e.target instanceof Element)) return;
    const img = /** @type {HTMLImageElement | null} */ (e.target.closest(`img[src^="${SVG_DATA}"]`));
    if (!img || overlay || img.closest(SLOWLY.thumbnail)) return;
    const r = img.getBoundingClientRect();
    if (r.width < 60) return;
    remixTarget = img;
    remix.style.display = 'block';
    Object.assign(remix.style, { left: `${r.right - remix.offsetWidth - 8}px`, top: `${r.top + 8}px` });
  });
  document.addEventListener('mouseout', e => {
    if (e.relatedTarget !== remix && e.target === remixTarget) remix.style.display = 'none';
  });
  remix.onclick = () => {
    if (!remixTarget) return;
    remix.style.display = 'none';
    open();
    post({ type: 'doodler:import-svg', svg: decodeSvg(remixTarget.getAttribute('src') ?? '') });
  };

  /** @param {string} src */
  function decodeSvg(src) { return decodeURIComponent(src.slice(src.indexOf(',') + 1)); }

  /** @param {object} msg */
  function post(msg) {
    if (ready && frame?.contentWindow) frame.contentWindow.postMessage(msg, origin);
    else queued.push(msg);
  }

  function frameUrl() {
    const url = new URL(pageUrl);
    for (const link of document.querySelectorAll('link[rel=stylesheet]')) {
      const href = new URL(/** @type {HTMLLinkElement} */ (link).href);
      if (href.origin === location.origin && href.pathname.startsWith(SLOWLY.stylesheetPath)) url.searchParams.append('css', href.href);
    }
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

  /** @param {string} text */
  function toast(text) {
    const t = css(document.createElement('div'),
      'position:fixed;right:18px;bottom:84px;z-index:2147483646;padding:12px 16px;border-radius:12px');
    t.className = 'toast show shadow-sm';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 7000);
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

  /** @param {object} sdj */
  async function attach(sdj) {
    if (document.querySelector(SLOWLY.editor))
      return toast('Close the open Slowly drawing editor first, then send again.');
    if (!findOpener()) document.querySelector(SLOWLY.replyPill)?.closest('button')?.click();
    const opener = await waitFor(findOpener, 3000);
    if (!opener || opener.disabled) return toast('Open a letter to reply to, then send the drawing again.');
    localStorage.setItem(PENDING, JSON.stringify(sdj));
    const show = hideNativeEditor();
    try {
      nativeClick = true;
      opener.click();
      nativeClick = false;
      if (!await waitFor(() => !localStorage.getItem(PENDING), 5000)) throw new Error('the editor did not pick the drawing up');
      const confirm = await waitFor(() => /** @type {HTMLElement | undefined} */ ([...document.querySelectorAll(SLOWLY.restoreConfirm)].pop()), 3000);
      if (!confirm) throw new SelectorMissing('restoreConfirm', 'no restore prompt');
      confirm.click();
      const done = await waitFor(() => {
        const b = /** @type {HTMLButtonElement | null} */ (document.querySelector(SLOWLY.editorDone));
        return b && !b.disabled && b;
      }, 3000);
      if (!done) throw new SelectorMissing('editorDone', 'save button not ready');
      done.click();
      const closed = await waitFor(() => !document.querySelector(SLOWLY.editor)
        || document.querySelector(SLOWLY.editorWarning), SAVE_TIMEOUT_MS);
      if (!closed || document.querySelector(SLOWLY.editor)) throw new Error('saving failed');
      show();
      toast('Drawing attached to your letter.');
    } catch (err) {
      nativeClick = false;
      localStorage.removeItem(PENDING);
      show();
      const reason = err instanceof Error ? err.message : String(err);
      if (err instanceof SelectorMissing) console.error('doodler_selector_missing', { selector: err.selector, reason });
      else console.error('doodler_attach_failed', { reason });
      toast(`Could not attach automatically (${reason}). Finish in the Slowly editor.`);
    }
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
