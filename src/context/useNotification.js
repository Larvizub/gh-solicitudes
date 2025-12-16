import React from 'react';
import { NotificationContext } from './NotificationContext';

function noopNotify(..._args) { try { /* noop */ } catch { void 0; } }

function _wrapNotify(maybeFn) {
  if (typeof maybeFn === 'function') {
    if (!maybeFn.notify) maybeFn.notify = maybeFn;
    return maybeFn;
  }
  const fn = (...args) => {
    try { if (maybeFn && typeof maybeFn.notify === 'function') return maybeFn.notify(...args); } catch { /* ignore */ }
  };
  fn.notify = (...args) => {
    try { if (maybeFn && typeof maybeFn.notify === 'function') return maybeFn.notify(...args); } catch { /* ignore */ }
  };
  return fn;
}

export default function useNotification() {
  // Defensive: if React or useContext is not available (possible multiple-React issue),
  // return a noop so the app doesn't crash while we debug the root cause.
  if (!React || typeof React.useContext !== 'function') {
    console.warn('[useNotification] React.useContext not available, returning noop');
    return _wrapNotify(noopNotify);
  }

  try {
    const ctx = React.useContext(NotificationContext);
    if (ctx && ctx.notify) return _wrapNotify(ctx.notify);
    return _wrapNotify((...args) => { try { console.warn('[Notification] provider not mounted, notify called with', args); } catch { void 0; } });
  } catch (err) {
    console.warn('[useNotification] error reading context, returning noop', err);
    return _wrapNotify(noopNotify);
  }
}
