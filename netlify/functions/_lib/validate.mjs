// Validación estricta de lo que el administrador envía. Todo es TEXTO PLANO:
// una notificación push no interpreta HTML, pero igual se limpia y se limita el tamaño.
import { httpError, siteOrigin, storeOrigin } from "./firebase.mjs";

const GROUP_RE = /^[a-z0-9_-]{1,30}$/;
const UID_RE = /^[A-Za-z0-9]{6,128}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function cleanText(value, field, max, { required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw httpError(400, `El campo "${field}" es obligatorio`);
    return "";
  }
  if (typeof value !== "string") throw httpError(400, `El campo "${field}" debe ser texto`);
  const text = value.replace(CONTROL_CHARS, " ").trim();
  if (required && !text) throw httpError(400, `El campo "${field}" es obligatorio`);
  if (text.length > max) throw httpError(400, `"${field}" supera ${max} caracteres`);
  return text;
}

/** URL de destino: ruta interna ("/promo"), URL del mismo origen o URL de la tienda configurada. */
function cleanTargetUrl(value) {
  const raw = cleanText(value, "url", 500, { required: false });
  if (!raw) return "/";
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) return raw;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw httpError(400, "La URL de destino no es válida");
  }
  // Evita usar la notificación como señuelo hacia sitios externos (phishing):
  // solo este sitio y la tienda configurada (STORE_URL).
  if (parsed.origin === storeOrigin()) return parsed.href;
  if (parsed.origin !== siteOrigin()) throw httpError(400, "La URL de destino debe ser de este sitio o de la tienda");
  return parsed.pathname + parsed.search + parsed.hash;
}

function cleanIcon(value) {
  const raw = cleanText(value, "icon", 500, { required: false });
  if (!raw) return "/icons/icon-192.png";
  if (raw.startsWith("/icons/") && !raw.includes("..")) return raw;
  if (/^https:\/\//i.test(raw)) return raw;
  throw httpError(400, "El icono debe ser /icons/... o una URL https");
}

function cleanImage(value) {
  const raw = cleanText(value, "image", 500, { required: false });
  if (!raw) return "";
  if (!/^https:\/\//i.test(raw)) throw httpError(400, "La imagen debe ser una URL https");
  return raw;
}

function cleanAudience(value) {
  if (!value || typeof value !== "object") throw httpError(400, "Falta la audiencia");
  switch (value.type) {
    case "all":
      return { type: "all" };
    case "uids": {
      const uids = Array.isArray(value.uids) ? [...new Set(value.uids)] : [];
      if (!uids.length || uids.length > 100) throw httpError(400, "Indicá entre 1 y 100 usuarios");
      if (!uids.every((u) => typeof u === "string" && UID_RE.test(u))) throw httpError(400, "UID inválido");
      return { type: "uids", uids };
    }
    case "groups": {
      const groups = Array.isArray(value.groups) ? [...new Set(value.groups)] : [];
      if (!groups.length || groups.length > 10) throw httpError(400, "Indicá entre 1 y 10 grupos");
      if (!groups.every((g) => typeof g === "string" && GROUP_RE.test(g))) throw httpError(400, "Grupo inválido");
      return { type: "groups", groups };
    }
    default:
      throw httpError(400, "Tipo de audiencia desconocido");
  }
}

export function validateNotification(input) {
  if (!input || typeof input !== "object") throw httpError(400, "Cuerpo inválido");
  const out = {
    title: cleanText(input.title, "title", 65),
    body: cleanText(input.body, "body", 240),
    url: cleanTargetUrl(input.url),
    icon: cleanIcon(input.icon),
    image: cleanImage(input.image),
    audience: cleanAudience(input.audience),
    sendAt: null,
  };
  if (input.sendAt) {
    const when = new Date(input.sendAt);
    const now = Date.now();
    if (Number.isNaN(when.getTime())) throw httpError(400, "Fecha de programación inválida");
    if (when.getTime() < now + 60_000) throw httpError(400, "La programación debe ser al menos 1 minuto en el futuro");
    if (when.getTime() > now + 90 * 86_400_000) throw httpError(400, "Máximo 90 días de anticipación");
    out.sendAt = when;
  }
  return out;
}
