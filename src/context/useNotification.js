import React from 'react';
import { NotificationContext } from './NotificationContext';

function noopNotify() { try { /* noop */ } catch { void 0; } }

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
  // Llamar a useContext de forma NO condicional
  const ctx = React.useContext(NotificationContext);
  try {
    if (ctx && ctx.notify) return _wrapNotify(ctx.notify);
  } catch (e) {
    console.warn('[useNotification] error reading context, returning noop', e);
    return _wrapNotify(noopNotify);
  }
  return _wrapNotify((...args) => { try { console.warn('[Notification] provider not mounted, notify called with', args); } catch { void 0; } });
}
