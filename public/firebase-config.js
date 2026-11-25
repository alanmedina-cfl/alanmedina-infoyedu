// Configuración PÚBLICA de la Web App de Firebase (Project settings -> Your apps -> SDK setup).
// Estos valores identifican el proyecto; NO son secretos. La seguridad la dan las Reglas de
// Firestore, la autenticación y el backend. Aquí NUNCA va una clave privada ni un service account.
//
// Es un script clásico (no módulo) para poder cargarlo tanto desde las páginas
// (<script src="/firebase-config.js">) como desde el Service Worker (importScripts).
self.FIREBASE_CONFIG = {
    apiKey: "AIzaSyDlZIhqXlWh7ujMtfNd7GZpqaMfrF_raQ4",
    authDomain: "alanmedina-infoyedu.firebaseapp.com",
    projectId: "alanmedina-infoyedu",
    storageBucket: "alanmedina-infoyedu.firebasestorage.app",
    messagingSenderId: "895621932570",
    appId: "1:895621932570:web:163e2e2bf50715cdf853a3"
};

// Clave pública VAPID: Project settings -> Cloud Messaging -> Web configuration -> Web Push certificates
self.FCM_VAPID_KEY = "BPDz6L9ZnyiQ7cthYg2tDra7DqiAdZoswcH_7LlyiOOrBWM_aVEgbwvl4BFj0IwUXg3qfe6P-8x2IGJDhAduLwE";

// Sitio al que la app instalada redirige al abrirse (y único sitio externo permitido en las notificaciones).
self.STORE_URL = "https://alanmedinainfoyedu.mitiendanube.com/";
