import { messaging } from '../firebase/firebaseConfig';
import { getToken, onMessage } from 'firebase/messaging';

const VAPID_KEY = import.meta.env.VITE_VAPID_KEY;

export async function registerForPush(onMessageCallback) {
    if (!('Notification' in window)) {
        console.log('This browser does not support notifications.');
        return null;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        console.log('Notification permission not granted:', permission);
        return null;
    }

    try {
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        console.log('Service worker registered for FCM:', registration.scope);

        if (!messaging) {
            console.warn('Firebase messaging is not available (messaging export is null).');
            return null;
        }

        const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
        
        if (token) {
            console.log('FCM token obtained:', token);
        }

        onMessage(messaging, (payload) => {
            console.log('Message received in foreground: ', payload);
            if (onMessageCallback) {
                onMessageCallback(payload);
            }
        });

        return token;
    } catch (error) {
        console.error('Error during FCM registration:', error);
        return null;
    }
}

export function listenForegroundMessages(callback) {
    if (!messaging) return () => {};
    return onMessage(messaging, (payload) => {
        console.log('Foreground message received:', payload);
        callback(payload);
    });
}
