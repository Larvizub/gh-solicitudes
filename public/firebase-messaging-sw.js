/* eslint-env serviceworker */
/* global importScripts, firebase, clients */
// firebase-messaging-sw.js
// Este archivo debe ubicarse en la raíz del sitio servido (public/firebase-messaging-sw.js)
// Maneja mensajes en segundo plano para Firebase Cloud Messaging (FCM).

// IMPORTANTE: Debes inicializar Firebase en este archivo con la misma configuración usada en la app.
// Los valores abajo son marcadores de posición. Reemplázalos con tus credenciales reales de Firebase.

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
    data: payload.data,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Opcional: manejar el evento notificationclick
self.addEventListener('notificationclick', function(event) {
  console.log('Al hacer clic en la notificación: ', event.notification);
  event.notification.close();
  const clickAction = (event.notification && event.notification.data && event.notification.data.click_action) || '/';
  event.waitUntil(clients.openWindow(clickAction));
});
