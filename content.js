(() => {
  const PENDING = 'doodler:pending';
  const SVG_DATA = 'data:image/svg+xml';
  const SAVE_TIMEOUT_MS = 20000;
  const pageUrl = chrome.runtime.getURL('index.html');
  const origin = new URL(pageUrl).origin;
  let overlay = null, frame = null, ready = false, queued = [], nativeClick = false;

  const css = (el, text) => { el.style.cssText = text; return el; };
  const isDark = () => document.documentElement.classList.contains('theme-dark');

  // selectors come from web.slowly.app main.*.js: composer toolbar button with i.icon-drawing, thumbnail
  // .drawing-thumbnail-edit, Reply pill with i.icon-pencil, editor .drawing-dialog / .drawing-done, alert .modal-footer
  const findOpener = () => document.querySelector('button.btn-toolbar i.icon-drawing')?.closest('button');
  const attachedSvg = () => {
    const src = document.querySelector('.drawing-thumbnail-preview img')?.getAttribute('src');
    return src?.startsWith(SVG_DATA) ? decodeSvg(src) : null;
  };

  document.addEventListener('click', e => {
    if (nativeClick || e.shiftKey) return;
    const opener = e.target.closest?.('button');
    if (!opener || !(opener.matches('.drawing-thumbnail-edit') || opener === findOpener())) return;
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
  let remixTarget = null;

  document.addEventListener('mouseover', e => {
    const img = e.target.closest?.(`img[src^="${SVG_DATA}"]`);
    if (!img || overlay || img.closest('.drawing-thumbnail-preview')) return;
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
    post({ type: 'doodler:import-svg', svg: decodeSvg(remixTarget.getAttribute('src')) });
  };

  function decodeSvg(src) { return decodeURIComponent(src.slice(src.indexOf(',') + 1)); }

  function post(msg) {
    if (ready) frame.contentWindow.postMessage(msg, origin);
    else queued.push(msg);
  }

  function frameUrl() {
    const url = new URL(pageUrl);
    for (const link of document.querySelectorAll('link[rel=stylesheet]')) {
      const href = new URL(link.href);
      if (href.origin === location.origin && href.pathname.startsWith('/static/css/')) url.searchParams.append('css', href.href);
    }
    if (isDark()) url.searchParams.set('theme', 'dark');
    return url.href;
  }

  function open() {
    if (overlay) return;
    ready = false;
    queued = [{ type: 'doodler:friends', ...globalThis.doodlerFriends() }];
    overlay = css(document.createElement('div'),
      'position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.5);backdrop-filter:blur(2px);'
      + 'display:grid;place-items:center');
    overlay.onclick = e => { if (e.target === overlay) close(); };
    frame = css(document.createElement('iframe'),
      `width:min(1280px,96vw);height:min(900px,94vh);border:0;border-radius:12px;background:${isDark() ? '#1b1d24' : '#f8f8f8'};`
      + 'box-shadow:0 20px 60px rgba(0,0,0,.35)');
    frame.src = frameUrl();
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', escClose);
  }

  function close() {
    overlay?.remove();
    overlay = frame = null;
    ready = false;
    queued = [];
    document.removeEventListener('keydown', escClose);
  }

  function escClose(e) { if (e.key === 'Escape') close(); }

  function toast(text) {
    const t = css(document.createElement('div'),
      'position:fixed;right:18px;bottom:84px;z-index:2147483646;padding:12px 16px;border-radius:12px');
    t.className = 'toast show shadow-sm';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 7000);
  }

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

  async function attach(sdj) {
    if (document.querySelector('.drawing-dialog'))
      return toast('Close the open Slowly drawing editor first, then send again.');
    if (!findOpener()) document.querySelector('button.rounded-pill i.icon-pencil')?.closest('button')?.click();
    const opener = await waitFor(findOpener, 3000);
    if (!opener || opener.disabled) return toast('Open a letter to reply to, then send the drawing again.');
    localStorage.setItem(PENDING, JSON.stringify(sdj));
    const show = hideNativeEditor();
    try {
      nativeClick = true;
      opener.click();
      nativeClick = false;
      if (!await waitFor(() => !localStorage.getItem(PENDING), 5000)) throw new Error('the editor did not pick the drawing up');
      const confirm = await waitFor(() => [...document.querySelectorAll('.modal-footer .btn-primary')].pop(), 3000);
      if (!confirm) throw new Error('no restore prompt');
      confirm.click();
      const done = await waitFor(() => {
        const b = document.querySelector('.drawing-dialog .drawing-done');
        return b && !b.disabled && b;
      }, 3000);
      if (!done) throw new Error('save button not ready');
      done.click();
      const closed = await waitFor(() => !document.querySelector('.drawing-dialog')
        || document.querySelector('.drawing-dialog .alert-warning'), SAVE_TIMEOUT_MS);
      if (!closed || document.querySelector('.drawing-dialog')) throw new Error('saving failed');
      show();
      toast('Drawing attached to your letter.');
    } catch (err) {
      nativeClick = false;
      localStorage.removeItem(PENDING);
      show();
      toast(`Could not attach automatically (${err.message}). Finish in the Slowly editor.`);
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
