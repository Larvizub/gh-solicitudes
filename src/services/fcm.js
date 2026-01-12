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
        
        if (token) {
            console.log('FCM token obtained:', token);
            // Opcional: enviar el token a tu backend o guardarlo en la base de datos de Firebase vinculada al usuario
        }

        // Mensajes en primer plano
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
