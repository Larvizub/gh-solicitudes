/* eslint-env serviceworker */
/* global importScripts, firebase, clients */
// firebase-messaging-sw.js
// Este archivo debe ubicarse en la raíz del sitio servido (public/firebase-messaging-sw.js)
// Maneja mensajes en segundo plano para Firebase Cloud Messaging (FCM).

// IMPORTANTE: Debes inicializar Firebase en este archivo con la misma configuración usada en la app.
// Por seguridad, aquí sólo puedes incluir las partes públicas de la configuración (los mismos valores que en src/firebase/firebaseConfig.js).

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// TODO: reemplaza la siguiente configuración con los valores de tu proyecto (los mismos que en src/firebase/firebaseConfig.js)
const firebaseConfig = {
  apiKey: 'REPLACE_WITH_YOUR_API_KEY',
  authDomain: 'REPLACE_WITH_YOUR_AUTH_DOMAIN',
  projectId: 'REPLACE_WITH_YOUR_PROJECT_ID',
  storageBucket: 'REPLACE_WITH_YOUR_STORAGE_BUCKET',
  messagingSenderId: 'REPLACE_WITH_YOUR_MESSAGING_SENDER_ID',
  appId: 'REPLACE_WITH_YOUR_APP_ID',
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// Personalizar el manejo de notificaciones en segundo plano
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Mensaje en segundo plano recibido ', payload);
  const notificationTitle = payload.notification?.title || 'Nueva notificación';
  const notificationOptions = {
    body: payload.notification?.body || JSON.stringify(payload.data || {}),
    icon: '/icons/icon-192.png',
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
