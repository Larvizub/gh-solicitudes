import React from 'react';
import { NotificationContext } from './NotificationContext';

function noopNotify(..._args) { try { /* noop */ } catch { void 0; } }

export default function useNotification() {
  // Defensive: if React or useContext is not available (possible multiple-React issue),
  // return a noop so the app doesn't crash while we debug the root cause.
  if (!React || typeof React.useContext !== 'function') {
    console.warn('[useNotification] React.useContext not available, returning noop');
    return noopNotify;
  }

  try {
    const ctx = React.useContext(NotificationContext);
    if (ctx && ctx.notify) return ctx.notify;
    return (...args) => { try { console.warn('[Notification] provider not mounted, notify called with', args); } catch { void 0; } };
  } catch (err) {
    console.warn('[useNotification] error reading context, returning noop', err);
    return noopNotify;
  }
}
