// POST /api/track  (lo llama el Service Worker del dispositivo)
// Cuerpo: { nid, did, event: "shown" | "click" }
// Cuenta como máximo UNA vez por dispositivo y evento. Son métricas APROXIMADAS:
// "shown" = el Service Worker ejecutó showNotification (no prueba que el usuario la viera).
import { services, readJson, json, errorResponse, httpError, FieldValue } from "./_lib/firebase.mjs";

const ID_RE = /^[A-Za-z0-9]{10,40}$/;
const FIELD = { shown: "shown", click: "clicked" };

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });
  try {
    const { nid, did, event } = await readJson(req, 1_000);
    if (!ID_RE.test(String(nid)) || !/^[a-f0-9]{64}$/.test(String(did)) || !FIELD[event]) {
      throw httpError(400, "Solicitud inválida");
    }
    const { db } = services();
    const nRef = db.collection("notifications").doc(nid);
    const eRef = nRef.collection("events").doc(`${did}_${event}`);
    const dRef = db.collection("devices").doc(did);

    await db.runTransaction(async (tx) => {
      const [n, e, d] = await Promise.all([tx.get(nRef), tx.get(eRef), tx.get(dRef)]);
      if (!n.exists || !d.exists) throw httpError(404, "No encontrado"); // solo dispositivos registrados
      if (e.exists) return; // ya contado
      tx.create(eRef, { at: FieldValue.serverTimestamp() });
      tx.update(nRef, { [`stats.${FIELD[event]}`]: FieldValue.increment(1) });
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config = { path: "/api/track" };
