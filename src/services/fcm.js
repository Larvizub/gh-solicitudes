// Ayudante de FCM: solicitar permiso, registrar el service worker de mensajería, obtener el token y enviarlo al backend
import { messaging } from '../firebase/firebaseConfig';
import { getToken, onMessage } from 'firebase/messaging';

// Asegúrate de que VITE_VAPID_KEY esté establecido en tu .env (clave VAPID pública)
const VAPID_KEY = import.meta.env.VITE_VAPID_KEY;

export async function registerForPush(onMessageCallback) {
    if (!('Notification' in window)) {
        console.log('This browser does not support notifications.');
        return null;
    }

    // Solicitar permiso
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        console.log('Notification permission not granted:', permission);
        return null;
    }

    // Registrar el service worker de Firebase Messaging si no está ya registrado
    try {
        // firebase-messaging-sw.js debe estar colocado en la raíz de public/
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        console.log('Service worker registered for FCM:', registration.scope);

        // Usar el service worker con messaging si está disponible
        if (!messaging) {
            console.warn('Firebase messaging is not available (messaging export is null).');
            return null;
        }

        // Obtener token FCM
        const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
        console.log('FCM token:', token);

        // Opcional: enviar el token a tu backend para guardarlo y usarlo en notificaciones dirigidas
        // await saveTokenToBackend(token);

        // Mensajes en primer plano
        if (onMessageCallback) {
            onMessage(messaging, (payload) => {
                console.log('Message received in foreground: ', payload);
                try {
                    onMessageCallback(payload);
                } catch {
                    // onMessage callback error suppressed to avoid console.error
                }
            });
        }

        return token;
    } catch {
        // suppressed console.error during push registration
        return null;
    }
}

export function listenForegroundMessages(callback) {
    if (!messaging) return;
    onMessage(messaging, callback);
}
