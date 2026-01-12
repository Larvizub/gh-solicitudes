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
    if (ctx && ctx.notify) {
      const result = _wrapNotify(ctx.notify);
      result.enableNotifications = ctx.enableNotifications;
      return result;
    }
  } catch (e) {
    console.warn('[useNotification] error reading context, returning noop', e);
    const result = _wrapNotify(noopNotify);
    result.enableNotifications = async () => null;
    return result;
  }
  const result = _wrapNotify((...args) => { try { console.warn('[Notification] provider not mounted, notify called with', args); } catch { void 0; } });
  result.enableNotifications = async () => null;
  return result;
}
