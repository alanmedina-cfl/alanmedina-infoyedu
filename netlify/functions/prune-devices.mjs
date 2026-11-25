// POST /api/prune-devices  (solo administradores)
// Cuerpo: { dryRun?: boolean }  -> detecta y elimina tokens inválidos u obsoletos.
//  - Obsoletos: sin actividad en STALE_DEVICE_DAYS (default 45).
//  - Inválidos: FCM los rechaza en una validación sin envío real (validateOnly).
import { services, requireAdmin, readJson, json, errorResponse, Timestamp } from "./_lib/firebase.mjs";

const INVALID = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);
const MAX_PER_RUN = 400; // evita superar el tiempo límite de la función

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });
  try {
    await requireAdmin(req);
    const { dryRun = true } = await readJson(req, 200);
    const { db, messaging } = services();

    const staleDays = Number(process.env.STALE_DEVICE_DAYS || 45);
    const cutoff = Timestamp.fromMillis(Date.now() - staleDays * 86_400_000);
    const snap = await db.collection("devices").select("token", "lastSeenAt").limit(MAX_PER_RUN).get();

    const stale = [];
    const invalid = [];
    const toCheck = [];
    snap.forEach((d) => {
      const seen = d.get("lastSeenAt");
      if (seen && seen.toMillis() < cutoff.toMillis()) stale.push(d.id);
      else toCheck.push(d);
    });

    // Validación con concurrencia limitada (sin enviar nada al dispositivo)
    for (let i = 0; i < toCheck.length; i += 20) {
      await Promise.all(
        toCheck.slice(i, i + 20).map(async (d) => {
          try {
            await messaging.send({ token: d.get("token"), data: { ping: "1" } }, true); // true = validateOnly
          } catch (err) {
            if (INVALID.has(err.code)) invalid.push(d.id);
          }
        }),
      );
    }

    const toDelete = [...new Set([...stale, ...invalid])];
    if (!dryRun && toDelete.length) {
      for (let i = 0; i < toDelete.length; i += 400) {
        const wb = db.batch();
        toDelete.slice(i, i + 400).forEach((id) => wb.delete(db.collection("devices").doc(id)));
        await wb.commit();
      }
    }
    return json(200, {
      dryRun,
      scanned: snap.size,
      stale: stale.length,
      invalid: invalid.length,
      deleted: dryRun ? 0 : toDelete.length,
      note: snap.size >= MAX_PER_RUN ? "Hay más dispositivos: volvé a ejecutar para seguir." : undefined,
    });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config = { path: "/api/prune-devices" };
