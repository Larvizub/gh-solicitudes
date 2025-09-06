// FCM helper: request permission, register messaging service worker, get token and send to backend
import { messaging } from '../firebase/firebaseConfig';
import { getToken, onMessage } from 'firebase/messaging';

// Ensure VITE_VAPID_KEY is set in your .env (public VAPID key)
const VAPID_KEY = import.meta.env.VITE_VAPID_KEY;

export async function registerForPush(onMessageCallback) {
  if (!('Notification' in window)) {
    console.log('This browser does not support notifications.');
    return null;
  }

  // Request permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.log('Notification permission not granted:', permission);
    return null;
  }

  // Register firebase messaging service worker if not already registered
  try {
    // firebase-messaging-sw.js must be placed at the public/ root
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    console.log('Service worker registered for FCM:', registration.scope);

    // Use the service worker with messaging if available
    if (!messaging) {
      console.warn('Firebase messaging is not available (messaging export is null).');
      return null;
    }

    // Get FCM token
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    console.log('FCM token:', token);

    // Optional: send token to your backend to save for push targeting
    // await saveTokenToBackend(token);

    // Foreground messages
    if (onMessageCallback) {
      onMessage(messaging, (payload) => {
        console.log('Message received in foreground: ', payload);
        try {
          onMessageCallback(payload);
        } catch (e) {
          console.error('onMessageCallback error', e);
        }
      });
    }

    return token;
  } catch (err) {
    console.error('Error registering for push', err);
    return null;
  }
}

export function listenForegroundMessages(callback) {
  if (!messaging) return;
  onMessage(messaging, callback);
}
