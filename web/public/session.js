/* Signs the person out once every Daji page is closed. While a page is open it holds a shared Web Lock, which the browser
   releases the moment the tab closes. A page that opens and finds nobody else holding the lock knows the last visit ended,
   so the saved sign-in is dropped. Refreshing, going back, and moving between the website and the desk keep the sign-in. */
(() => {
  try {
    if (!navigator.locks || !navigator.locks.query) return;
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    let sameSite = false;
    try { sameSite = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch { /* no referrer */ }
    const continuing = !!nav && (nav.type === 'reload' || nav.type === 'back_forward') || sameSite;
    navigator.locks.query().then((q) => {
      const others = ((q && q.held) || []).some((l) => l.name === 'daji-open');
      if (!others && !continuing && localStorage.getItem('daji.token')) {
        localStorage.removeItem('daji.token');
        location.reload(); // start again signed out
        return;
      }
      navigator.locks.request('daji-open', { mode: 'shared' }, () => new Promise(() => { /* held until this page closes */ }));
    }).catch(() => { /* locks unavailable: the sign-in simply stays */ });
  } catch { /* storage or locks blocked: leave the sign-in alone */ }
})();
