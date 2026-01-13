/* eslint-env serviceworker */
/* global importScripts, firebase, clients */
// firebase-messaging-sw.js
// Este archivo debe ubicarse en la raíz del sitio servido (public/firebase-messaging-sw.js)
// Maneja mensajes en segundo plano para Firebase Cloud Messaging (FCM).

// IMPORTANTE: Vite reemplazará estos placeholders durante el build basándose en tu archivo .env
// gracias al plugin 'service-worker-transformer' configurado en vite.config.js.

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "FIREBASE_API_KEY_PLACEHOLDER",
  authDomain: "FIREBASE_AUTH_DOMAIN_PLACEHOLDER",
  databaseURL: "FIREBASE_DATABASE_URL_PLACEHOLDER",
  projectId: "FIREBASE_PROJECT_ID_PLACEHOLDER",
  storageBucket: "FIREBASE_STORAGE_BUCKET_PLACEHOLDER",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID_PLACEHOLDER",
  appId: "FIREBASE_APP_ID_PLACEHOLDER"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Mensaje en segundo plano recibido ', payload);
  
  const notificationTitle = payload.notification?.title || 'Nueva notificación de GH Solicitudes';
  const notificationOptions = {
    body: payload.notification?.body || 'Tienes un mensaje nuevo.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'firebase-push-notification', // Evita duplicados
    renotify: true,
    data: {
        url: payload.data?.click_action || '/'
    }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Manejar el clic en la notificación para abrir la app o una URL específica
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  const targetUrl = event.notification.data.url;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si ya hay una ventana abierta, enfocarla
      for (const client of windowClients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no hay ventana abierta, abrir una nueva
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
