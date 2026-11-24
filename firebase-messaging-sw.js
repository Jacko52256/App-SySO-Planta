importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDpWyi18A5KJdJLS9RGEK0fVmkm4DcoKqU",
  authDomain: "syso-industrial.firebaseapp.com",
  databaseURL: "https://syso-industrial-default-rtdb.firebaseio.com",
  projectId: "syso-industrial",
  storageBucket: "syso-industrial.firebasestorage.app",
  messagingSenderId: "89972723899",
  appId: "1:89972723899:web:731db5a9c03a3ff3e5599e"
});

const messaging = firebase.messaging();

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

messaging.onBackgroundMessage((payload) => {
  if (payload && payload.notification) return;
  const d = (payload && payload.data) || {};
  const titulo = d.titulo || `🚨 ALERTA S.O.S.: ${(d.tipo || "EMERGENCIA").toUpperCase()}`;
  const cuerpo = d.cuerpo || `Sector: ${d.seccion || "Planta"} | Reporta: ${d.reporta || "Operario"}`;
  self.registration.showNotification(titulo, {
    body: cuerpo,
    tag: "sos_syso_alert",
    renotify: true,
    requireInteraction: true,
    vibrate: [500, 150, 500, 150, 500],
    data: { url: d.url || "https://jacko52256.github.io/App-SySO-Planta/" }
  });
});
