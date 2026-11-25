// Pantalla de bienvenida: activa notificaciones y lleva a la tienda.
// La redirección instantánea de la app instalada la hace /js/redirect.js (antes de cargar este módulo).
import { auth, db, onAuthStateChanged, signInAnonymously, doc, getDoc, setDoc, updateDoc, serverTimestamp } from "./firebase.js";
import { enablePush, disablePush, refreshPush, onForegroundMessage, pushState, pushSupport } from "./push.js";
import { registerServiceWorker, setupInstallButton } from "./pwa.js";

const ONBOARDED_KEY = "onboarded.v1";
const REFRESH_KEY = "push.lastRefresh";
const ALL_GROUPS = ["news", "offers", "events"]; // coinciden con firestore.rules
const STORE_URL = self.STORE_URL;

const $ = (id) => document.getElementById(id);
const els = {
  status: $("push-status"),
  enable: $("btn-enable"),
  skip: $("btn-skip"),
  store: $("btn-store"),
  disable: $("btn-disable"),
  install: $("btn-install"),
  toasts: $("toasts"),
  iosHelp: $("ios-help"),
  deniedHelp: $("denied-help"),
  offlineHelp: $("offline-help"),
};

const MESSAGES = {
  unsupported: "Este navegador no admite avisos push, pero podés entrar a la tienda igual.",
  "ios-install": "En iPhone/iPad los avisos solo funcionan con la app instalada en la pantalla de inicio.",
  denied: "Los avisos están bloqueados para este sitio. Podés entrar a la tienda igual.",
  default: "Activá los avisos para enterarte de novedades y ofertas. Después la app te lleva directo a la tienda cada vez que la abras.",
  granted: "Avisos activados en este dispositivo.",
};

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } };

const goStore = () => location.replace(STORE_URL);
const isStandalone = () => pushSupport().standalone;
const isOnboarded = () => lsGet(ONBOARDED_KEY) === "1";

function render() {
  const state = pushState();
  const offline = navigator.onLine === false;
  els.status.textContent = MESSAGES[state];
  els.enable.hidden = state !== "default";
  els.disable.hidden = state !== "granted";
  // "Entrar sin avisos" solo en la app instalada y antes de la primera entrada
  els.skip.hidden = !(isStandalone() && !isOnboarded() && state !== "granted");
  els.store.hidden = !els.skip.hidden;
  els.iosHelp.hidden = state !== "ios-install";
  els.deniedHelp.hidden = state !== "denied";
  els.offlineHelp.hidden = !offline;
}

/** Aviso dentro de la página (primer plano). Usa textContent: nunca innerHTML con datos externos. */
function showToast({ title = "", body = "", url = "/" }) {
  const toast = document.createElement("a");
  toast.className = "toast";
  toast.href = url.startsWith("/") || url.startsWith(STORE_URL) ? url : "/";
  const t = document.createElement("strong");
  t.textContent = title;
  const b = document.createElement("span");
  b.textContent = body;
  toast.append(t, b);
  els.toasts.append(toast);
  setTimeout(() => toast.remove(), 8000);
}

async function ensureUserDoc(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { createdAt: serverTimestamp(), lastSeenAt: serverTimestamp(), groups: [] });
  } else {
    await updateDoc(ref, { createdAt: snap.data().createdAt, lastSeenAt: serverTimestamp(), groups: snap.data().groups || [] });
  }
}

// Se resuelve cuando hay sesión anónima (necesaria para registrar el dispositivo)
let resolveAuth;
const authReady = new Promise((resolve) => { resolveAuth = resolve; });
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);

function markOnboarded() {
  lsSet(ONBOARDED_KEY, "1");
}

async function start() {
  // redirect.js ya está navegando a la tienda: solo se mantiene al día el Service Worker
  if (window.__instantRedirect) { registerServiceWorker(); return; }
  await registerServiceWorker();
  setupInstallButton(els.install);

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      await signInAnonymously(auth).catch((e) => console.error("¿Auth anónima deshabilitada?", e));
      return;
    }
    resolveAuth(user);
    ensureUserDoc(user.uid).catch(console.warn);
  });

  // App instalada que ya pasó por la bienvenida, con el token a renovar (1 vez por semana):
  // se renueva en segundo plano con un tope de 4 s y se entra a la tienda.
  if (isStandalone() && isOnboarded() && pushState() === "granted" && !/(^|[?&])setup(=|&|$)/.test(location.search)) {
    await withTimeout((async () => {
      await authReady;
      await refreshPush({ groups: ALL_GROUPS });
      lsSet(REFRESH_KEY, String(Date.now()));
    })(), 4000);
    goStore();
    return;
  }

  render();
  window.addEventListener("online", () => { render(); if (isStandalone() && isOnboarded()) goStore(); });
  window.addEventListener("offline", render);

  els.enable.addEventListener("click", async () => {
    els.enable.disabled = true;
    await authReady;
    const result = await enablePush({ groups: ALL_GROUPS });
    els.enable.disabled = false;
    if (result.ok) {
      lsSet(REFRESH_KEY, String(Date.now()));
      markOnboarded();
      goStore();
    } else if (result.reason === "error") {
      els.status.textContent = "No se pudo activar. Probá de nuevo.";
    } else {
      render(); // permiso denegado o cerrado sin elegir
    }
  });

  els.skip.addEventListener("click", () => { markOnboarded(); goStore(); });
  els.store.addEventListener("click", goStore);

  els.disable.addEventListener("click", async () => {
    await disablePush();
    render();
  });

  onForegroundMessage(showToast);
}

start();
