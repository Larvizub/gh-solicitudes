/* eslint-env serviceworker */
/* global importScripts, firebase, clients */
// firebase-messaging-sw.js
// This file must be placed at the root of the served site (public/firebase-messaging-sw.js)
// It handles background messages for Firebase Cloud Messaging (FCM).

// IMPORTANT: You must initialize Firebase in this file with the same config used in the app.
// For security, you can include only the public parts of the config here (the same values in src/firebase/firebaseConfig.js).

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// TODO: replace the following config with your project's values (same as in src/firebase/firebaseConfig.js)
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

// Customize background notification handling
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification?.title || 'Nueva notificación';
  const notificationOptions = {
    body: payload.notification?.body || JSON.stringify(payload.data || {}),
    icon: '/icons/icon-192.png',
    data: payload.data,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Optional: handle notificationclick
self.addEventListener('notificationclick', function(event) {
  console.log('On notification click: ', event.notification);
  event.notification.close();
  const clickAction = (event.notification && event.notification.data && event.notification.data.click_action) || '/';
  event.waitUntil(clients.openWindow(clickAction));
});
