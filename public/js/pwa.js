// Registro del Service Worker (único: caché de la PWA + Firebase Messaging) e instalación.
let deferredPrompt = null;

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (err) {
    console.error("No se pudo registrar el Service Worker", err);
    return null;
  }
}

/** Chrome/Edge (Android y escritorio) disparan beforeinstallprompt; Safari/iOS no. */
export function setupInstallButton(button) {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    button.hidden = false;
  });
  button.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    button.hidden = true;
  });
  window.addEventListener("appinstalled", () => { button.hidden = true; });
}
