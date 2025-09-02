import { useContext } from 'react';
import { NotificationContext } from './NotificationContext';

export default function useNotification() {
  const ctx = useContext(NotificationContext);
  // ctx may be undefined if provider not mounted; return a safe noop
  if (ctx && ctx.notify) return ctx.notify;
  return (...args) => { try { console.warn('[Notification] provider not mounted, notify called with', args); } catch { void 0; } };
}
