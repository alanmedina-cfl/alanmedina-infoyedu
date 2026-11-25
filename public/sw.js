/* Service Worker ÚNICO de la app: caché básica de la PWA + Firebase Cloud Messaging.
 *
 * Solo puede haber un Service Worker por scope, por eso el caché y FCM conviven aquí
 * (la página pasa este registro a getToken({ serviceWorkerRegistration })).
 *
 * Los mensajes que envía el backend son SOLO DE DATOS. Con la app cerrada o en segundo plano
 * llegan a onBackgroundMessage y este archivo muestra la notificación. Con la app en primer
 * plano llegan a onMessage (página) y este archivo no muestra nada: sin duplicados.
 *
 * Si cambiás la versión del SDK, actualizá las dos líneas importScripts y /js/firebase.js.
 */
importScripts("/firebase-config.js");
importScripts("https://www.gstatic.com/firebasejs/13.4.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/13.4.0/firebase-messaging-compat.js");

firebase.initializeApp(self.FIREBASE_CONFIG);
const messaging = firebase.messaging();

// ---------------------------------------------------------------- Notificaciones push
function trackEvent(data, event) {
  if (!data || !data.nid || !data.did) return Promise.resolve();
  return fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nid: data.nid, did: data.did, event }),
    keepalive: true,
  }).catch(() => {});
}

// Solo rutas de este origen o de la tienda configurada: una notificación no puede llevar a otro sitio.
const STORE_ORIGIN = new URL(self.STORE_URL).origin;
function sameOriginUrl(raw) {
  try {
    const url = new URL(raw || "/", self.location.origin);
    return url.origin === self.location.origin || url.origin === STORE_ORIGIN ? url.href : self.location.origin + "/";
  } catch {
    return self.location.origin + "/";
  }
}

function safeIcon(raw) {
  return raw && (raw.startsWith("/icons/") || raw.startsWith("https://")) ? raw : "/icons/icon-192.png";
}

messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const options = {
    body: String(d.body || "").slice(0, 300),
    icon: safeIcon(d.icon),
    badge: "/icons/icon-192.png",
    tag: d.nid || undefined, // misma notificación = se reemplaza, no se duplica
    data: { url: d.url || "/", nid: d.nid, did: d.did },
  };
  if (d.image && d.image.startsWith("https://")) options.image = d.image;
  trackEvent(d, "shown");
  return self.registration.showNotification(String(d.title || "Notificación").slice(0, 100), options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = sameOriginUrl(data.url);
  event.waitUntil(
    (async () => {
      trackEvent(data, "click");
      const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target).catch(() => {});
          return;
        }
      }
      await clients.openWindow(target);
    })(),
  );
});

// ---------------------------------------------------------------- Caché de la PWA
const CACHE = "app-shell-v2"; // subí el número para forzar limpieza de caché
const PRECACHE = [
  "/", "/offline.html", "/css/styles.css", "/manifest.json",
  "/js/app.js", "/js/redirect.js", "/js/push.js", "/js/pwa.js", "/js/firebase.js",
  "/icons/icon-192.png", "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // Firebase/gstatic: no tocar
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin") || url.pathname === "/firebase-config.js") return;

  if (req.mode === "navigate") {
    // Páginas: red primero; sin red, caché y por último /offline.html
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(req)) || (await caches.match("/offline.html"))),
    );
    return;
  }

  // Recursos estáticos: stale-while-revalidate
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
