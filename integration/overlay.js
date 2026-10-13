(() => {
  const owner = Symbol.for('fancy-dsh.startup-overlay');
  if (window[owner]) return;
  window[owner] = true;
  const notifyHost = event => {
    try { window.webkit?.messageHandlers?.normandy?.postMessage({ source: 'normandy-startup', event }); } catch { /* Browser playback has no native host. */ }
  };
  const start = () => {
    const boot = window.__FANCY_DSH_BOOT__;
    if (!boot?.enabled || typeof boot.instance !== 'string') { notifyHost('complete'); return; }
    const key = `fancy-dsh-startup:${boot.instance}`;
    try {
      if (sessionStorage.getItem(key)) { notifyHost('complete'); return; }
      sessionStorage.setItem(key, 'started');
    } catch { notifyHost('error'); return; }

    const frame = document.createElement('iframe');
    frame.title = 'Normandy startup';
    frame.id = 'fancy-dsh-startup';
    frame.allow = 'autoplay';
    frame.tabIndex = 0;
    frame.src = '/__fancy_dsh/dist/cinematic/?embed=1&autoplay=1';
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483646;background:#020912;';
    const exit = document.createElement('button');
    exit.type = 'button';
    exit.textContent = '返回 DSH · Esc';
    exit.setAttribute('aria-label', '跳过开场，返回 DSH');
    exit.style.cssText = 'position:fixed;top:16px;right:18px;z-index:2147483647;border:1px solid #78a8b866;background:#07151ee6;color:#cbe8f1;padding:8px 13px;font:12px/1.3 system-ui,sans-serif;letter-spacing:.05em;cursor:pointer;';
    const previousFocus = document.activeElement;
    const inert = new Map();
    let closed = false;
    let observer;
    let deadline;
    const isolate = node => {
      if (node.nodeType !== 1 || node === frame || node === exit || inert.has(node)) return;
      inert.set(node, node.inert);
      node.inert = true;
    };
    const dismiss = event => {
      if (closed) return;
      closed = true;
      clearTimeout(deadline);
      observer?.disconnect();
      window.removeEventListener('message', message);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('focusin', containFocus, true);
      for (const [node, wasInert] of inert) node.inert = wasInert;
      frame.remove();
      exit.remove();
      try { sessionStorage.setItem(key, 'done'); } catch { /* The initial tab claim is sufficient. */ }
      if (previousFocus?.isConnected && !previousFocus.inert) previousFocus.focus?.();
      notifyHost(event);
    };
    const message = event => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.source !== 'normandy-startup') return;
      if (event.data.event === 'ready') {
        clearTimeout(deadline);
        notifyHost('ready');
        return;
      }
      if (['complete', 'skip', 'error'].includes(event.data.event)) dismiss(event.data.event);
    };
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss('skip'); }
    };
    const containFocus = event => {
      if (event.target !== frame && event.target !== exit && !closed) frame.focus();
    };
    exit.addEventListener('click', () => dismiss('skip'));
    frame.addEventListener('error', () => dismiss('error'), { once: true });
    window.addEventListener('message', message);
    window.addEventListener('keydown', escape);
    window.addEventListener('focusin', containFocus, true);
    for (const node of document.body.children) isolate(node);
    observer = new MutationObserver(changes => {
      for (const change of changes) for (const node of change.addedNodes) isolate(node);
    });
    observer.observe(document.body, { childList: true });
    deadline = setTimeout(() => dismiss('error'), 15000);
    document.body.append(frame, exit);
    frame.focus();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
