// Lógica de notificaciones push del lado del visitante.
import {
  auth, db, getMessagingIfSupported, getToken, deleteToken, onMessage,
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from "./firebase.js";

const LS_DEVICE = "push.deviceId";

/** Diagnóstico de compatibilidad. No promete soporte universal: informa el motivo. */
export function pushSupport() {
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const hasAPIs = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return {
    isIOS,
    standalone,
    hasAPIs,
    secure: window.isSecureContext,
    permission: "Notification" in window ? Notification.permission : "unsupported",
  };
}

/** Estado resumido para la interfaz. */
export function pushState() {
  const s = pushSupport();
  if (!s.secure || !s.hasAPIs) {
    // En iPhone/iPad las APIs de push solo existen con la app instalada en la pantalla de inicio
    return s.isIOS && !s.standalone ? "ios-install" : "unsupported";
  }
  if (s.isIOS && !s.standalone) return "ios-install";
  if (s.permission === "denied") return "denied";
  if (s.permission === "granted") return "granted";
  return "default";
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function detectPlatform() {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/firefox/i.test(ua)) return "firefox";
  if (/edg\//i.test(ua)) return "edge";
  if (/chrome|crios/i.test(ua)) return "chrome";
  if (/safari/i.test(ua)) return "safari";
  return "other";
}

/** Registra/actualiza el dispositivo. El ID del documento es el hash del token: sin duplicados. */
async function saveDevice(token, groups) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sin sesión anónima");
  const deviceId = await sha256Hex(token);
  const ref = doc(db, "devices", deviceId);
  const base = { token, platform: detectPlatform(), groups, permission: "granted" };

  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { ...base, uid: snap.data().uid, createdAt: snap.data().createdAt, lastSeenAt: serverTimestamp() });
  } else {
    await setDoc(ref, { ...base, uid: user.uid, createdAt: serverTimestamp(), lastSeenAt: serverTimestamp() });
  }

  // Si el token cambió (renovación), eliminar el documento del token anterior
  const previous = localStorage.getItem(LS_DEVICE);
  if (previous && previous !== deviceId) {
    try { await deleteDoc(doc(db, "devices", previous)); } catch { /* ya no existe o no es nuestro */ }
  }
  localStorage.setItem(LS_DEVICE, deviceId);
  return deviceId;
}

async function obtainToken(messaging) {
  const registration = await navigator.serviceWorker.ready;
  return getToken(messaging, { vapidKey: self.FCM_VAPID_KEY, serviceWorkerRegistration: registration });
}

/**
 * Activa las notificaciones. DEBE llamarse desde un gesto del usuario (click en un botón):
 * los navegadores bloquean o ignoran requestPermission() lanzado automáticamente.
 */
export async function enablePush({ groups = [] } = {}) {
  const state = pushState();
  if (state === "unsupported" || state === "ios-install") return { ok: false, reason: state };
  const messaging = await getMessagingIfSupported();
  if (!messaging) return { ok: false, reason: "unsupported" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: permission }; // "denied" | "default"

  try {
    const token = await obtainToken(messaging);
    if (!token) return { ok: false, reason: "no-token" };
    await saveDevice(token, groups);
    return { ok: true };
  } catch (err) {
    console.error("No se pudo activar push", err);
    return { ok: false, reason: "error" };
  }
}

/**
 * Se llama en cada carga si el permiso ya fue concedido: renueva/valida el token
 * (el SDK devuelve el vigente) y actualiza lastSeenAt. Así se cubre la renovación de tokens.
 */
export async function refreshPush({ groups = [] } = {}) {
  if (pushState() !== "granted") return;
  const messaging = await getMessagingIfSupported();
  if (!messaging) return;
  try {
    const token = await obtainToken(messaging);
    if (token) await saveDevice(token, groups);
  } catch (err) {
    // Típico: el dispositivo quedó asociado a otra sesión anónima -> regenerar token
    console.warn("Regenerando token FCM", err);
    try {
      await deleteToken(messaging);
      const token = await obtainToken(messaging);
      if (token) await saveDevice(token, groups);
    } catch (e2) {
      console.error("No se pudo renovar el token", e2);
    }
  }
}

export async function updateGroups(groups) {
  const id = localStorage.getItem(LS_DEVICE);
  if (!id) return;
  await updateDoc(doc(db, "devices", id), { groups, lastSeenAt: serverTimestamp() });
}

/** Desactiva: borra el token en FCM y el documento del dispositivo. */
export async function disablePush() {
  const messaging = await getMessagingIfSupported();
  if (messaging) await deleteToken(messaging).catch(() => {});
  const id = localStorage.getItem(LS_DEVICE);
  if (id) await deleteDoc(doc(db, "devices", id)).catch(() => {});
  localStorage.removeItem(LS_DEVICE);
}

/**
 * Mensajes con la app en PRIMER PLANO. FCM los entrega solo a la página (onMessage) y el
 * Service Worker no muestra nada: por eso no hay notificaciones duplicadas.
 */
export async function onForegroundMessage(callback) {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => callback(payload.data || {}));
}
