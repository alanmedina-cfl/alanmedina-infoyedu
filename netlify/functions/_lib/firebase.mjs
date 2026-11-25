// Inicialización de Firebase Admin SDK + utilidades comunes de las funciones.
// Las credenciales vienen SOLO de variables de entorno de Netlify (nunca del frontend).
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

export { FieldValue, Timestamp };

function init() {
  if (getApps().length) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // En variables de entorno los saltos de línea suelen guardarse como "\n" literales
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Faltan FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY");
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export function services() {
  init();
  return { auth: getAuth(), db: getFirestore(), messaging: getMessaging() };
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Convierte cualquier error en una respuesta sin filtrar detalles internos. */
export function errorResponse(err) {
  if (err && err.status) return json(err.status, { error: err.message });
  console.error("Error interno:", err);
  return json(500, { error: "Error interno del servidor" });
}

/**
 * Autorización en backend: verifica el ID token de Firebase y el custom claim admin.
 * Ocultar la URL /admin NO protege nada; esta comprobación es la que protege.
 */
export async function requireAdmin(req) {
  const match = (req.headers.get("authorization") || "").match(/^Bearer (.+)$/i);
  if (!match) throw httpError(401, "Falta el token de sesión");
  const { auth } = services();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(match[1], true); // true = comprobar revocación
  } catch {
    throw httpError(401, "Sesión inválida o revocada");
  }
  if (decoded.admin !== true || decoded.firebase?.sign_in_provider !== "password") {
    throw httpError(403, "No tenés permisos de administrador");
  }
  return decoded;
}

export async function readJson(req, maxBytes = 10_000) {
  const text = await req.text();
  if (text.length > maxBytes) throw httpError(413, "Solicitud demasiado grande");
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, "JSON inválido");
  }
}

export function siteOrigin() {
  // Netlify define URL (dominio principal del sitio). En local usa localhost:8888.
  return new URL(process.env.URL || "http://localhost:8888").origin;
}

/** Sitio de la tienda al que la app redirige y al que pueden apuntar las notificaciones. */
export function storeUrl() {
  return process.env.STORE_URL || "https://alanmedinainfoyedu.mitiendanube.com/";
}

export function storeOrigin() {
  return new URL(storeUrl()).origin;
}
