// Único lugar donde se fija la versión del SDK de Firebase para las páginas.
// Si la cambiás, cambiá también la versión en las dos líneas importScripts de /sw.js.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import { getMessaging, isSupported } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-messaging.js";

export {
  onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword,
  sendPasswordResetEmail, signOut, getIdTokenResult,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

export {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, query, where, orderBy,
  limit, onSnapshot, getCountFromServer, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

export { getToken, deleteToken, onMessage } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-messaging.js";

if (!self.FIREBASE_CONFIG || self.FIREBASE_CONFIG.apiKey === "REEMPLAZAR") {
  console.warn("Completá /firebase-config.js con la configuración de tu Web App de Firebase.");
}

export const app = initializeApp(self.FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);

/** Messaging solo existe en navegadores compatibles (HTTPS, Service Worker, Push API). */
export async function getMessagingIfSupported() {
  return (await isSupported()) ? getMessaging(app) : null;
}
