(() => {
  const IDLE_MS = 30 * 60 * 1000;
  const PING_INTERVAL_MS = 60 * 1000;
  let lastActivity = Date.now();
  let lastPing = 0;
  let timer;

  const lock = () => {
    window.location.replace('/cover.html?expired=1');
  };

  const ping = async () => {
    try {
      const response = await fetch('/api/cover-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        cache: 'no-store'
      });
      if (response.status === 401) lock();
    } catch {
      // Temporary network failure does not alter Supabase authentication or data.
    }
  };

  const activity = () => {
    const now = Date.now();
    if (now - lastActivity >= IDLE_MS) return lock();
    lastActivity = now;
    if (now - lastPing >= PING_INTERVAL_MS) {
      lastPing = now;
      void ping();
    }
    clearTimeout(timer);
    timer = setTimeout(lock, IDLE_MS);
  };

  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(type =>
    window.addEventListener(type, activity, { passive: true })
  );
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) activity();
  });
  timer = setTimeout(lock, IDLE_MS);
})();
