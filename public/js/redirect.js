// Redirección instantánea a la tienda. Script clásico y síncrono: corre antes de pintar la página.
//
// Regla: SOLO redirige cuando la app está instalada (modo standalone) y el visitante ya pasó
// por la pantalla de bienvenida. En una pestaña normal del navegador nunca redirige, para que
// se pueda instalar la app y activar las notificaciones. Con /?setup se fuerza la pantalla
// de configuración aunque la app esté instalada (para reactivar avisos).
(function () {
  var KEY = "onboarded.v1";
  var REFRESH_KEY = "push.lastRefresh";
  var REFRESH_EVERY_MS = 7 * 24 * 3600 * 1000; // renovar el token FCM como máximo 1 vez por semana
  var store = self.STORE_URL;

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  var standalone =
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    navigator.standalone === true;
  var forceSetup = /(^|[?&])setup(=|&|$)/.test(location.search);
  var onboarded = safeGet(KEY) === "1";
  var last = Number(safeGet(REFRESH_KEY) || 0);
  var needsRefresh =
    typeof Notification !== "undefined" && Notification.permission === "granted" &&
    Date.now() - last > REFRESH_EVERY_MS;

  window.__goStore = function () { location.replace(store); };
  window.__instantRedirect = false;

  if (standalone && onboarded && !forceSetup && navigator.onLine !== false && !needsRefresh) {
    window.__instantRedirect = true;
    document.documentElement.className += " redirecting"; // oculta el contenido mientras navega
    location.replace(store);
  }
})();
