// Envío real de una notificación con Firebase Admin SDK (FCM HTTP v1).
//
// IMPORTANTE sobre las métricas:
//   accepted  = FCM aceptó el mensaje para entregarlo (NO implica que se haya mostrado)
//   rejected  = FCM lo rechazó (token inválido, error de payload, etc.)
//   shown / clicked = los reporta el Service Worker del dispositivo vía /api/track (aproximado)
import { services, FieldValue } from "./firebase.mjs";

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);
const BATCH = 500; // límite de sendEach por llamada

/** Devuelve Map(deviceId -> token) con los dispositivos que cumplen la audiencia. */
async function collectTargets(db, audience) {
  const targets = new Map();
  const add = (snap) => snap.forEach((d) => d.data().token && targets.set(d.id, d.data().token));

  if (audience.type === "all") {
    add(await db.collection("devices").select("token").get());
  } else if (audience.type === "uids") {
    for (let i = 0; i < audience.uids.length; i += 30) {
      add(await db.collection("devices").where("uid", "in", audience.uids.slice(i, i + 30)).select("token").get());
    }
  } else if (audience.type === "groups") {
    add(
      await db.collection("devices").where("groups", "array-contains-any", audience.groups.slice(0, 30)).select("token").get(),
    );
  }
  return targets;
}

/**
 * Envía la notificación `notifId`. Es idempotente: solo procesa documentos en estado
 * "queued" o "scheduled" y los reclama con una transacción para evitar envíos dobles.
 */
export async function dispatch(notifId) {
  const { db, messaging } = services();
  const ref = db.collection("notifications").doc(notifId);

  const notif = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data();
    if (!["queued", "scheduled"].includes(data.status)) return null;
    tx.update(ref, { status: "sending", startedAt: FieldValue.serverTimestamp() });
    return data;
  });
  if (!notif) return { status: "skipped" };

  const stats = { recipients: 0, accepted: 0, rejected: 0, invalidRemoved: 0 };
  const errorCounts = {};

  try {
    const targets = await collectTargets(db, notif.audience);
    stats.recipients = targets.size;

    if (!targets.size) {
      await ref.update({ status: "no_recipients", finishedAt: FieldValue.serverTimestamp(), "stats.recipients": 0 });
      return { status: "no_recipients", stats };
    }

    const entries = [...targets.entries()]; // [deviceId, token]
    for (let i = 0; i < entries.length; i += BATCH) {
      const slice = entries.slice(i, i + BATCH);
      // Mensajes SOLO de datos: el Service Worker decide cómo mostrarlos (sin duplicados).
      const messages = slice.map(([deviceId, token]) => ({
        token,
        data: {
          title: notif.title,
          body: notif.body,
          url: notif.url,
          icon: notif.icon,
          image: notif.image || "",
          nid: notifId,
          did: deviceId,
        },
        webpush: { headers: { TTL: "86400", Urgency: "normal" } },
      }));

      const res = await messaging.sendEach(messages);
      const batchErrors = {};
      const toDelete = [];

      res.responses.forEach((r, idx) => {
        if (r.success) {
          stats.accepted++;
          return;
        }
        stats.rejected++;
        const code = r.error?.code || "unknown";
        batchErrors[code] = (batchErrors[code] || 0) + 1;
        errorCounts[code] = (errorCounts[code] || 0) + 1;
        if (INVALID_TOKEN_CODES.has(code)) toDelete.push(slice[idx][0]);
      });

      if (toDelete.length) {
        const wb = db.batch();
        toDelete.forEach((id) => wb.delete(db.collection("devices").doc(id)));
        await wb.commit();
        stats.invalidRemoved += toDelete.length;
      }

      await db.collection("notification_logs").add({
        notificationId: notifId,
        batch: Math.floor(i / BATCH),
        size: slice.length,
        accepted: res.successCount,
        rejected: res.failureCount,
        invalidRemoved: toDelete.length,
        errors: batchErrors,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    const status = stats.accepted === 0 ? "failed" : stats.rejected > 0 ? "partial" : "sent";
    await ref.update({
      status,
      finishedAt: FieldValue.serverTimestamp(),
      "stats.recipients": stats.recipients,
      "stats.accepted": stats.accepted,
      "stats.rejected": stats.rejected,
      "stats.invalidRemoved": stats.invalidRemoved,
      errorCounts,
    });
    return { status, stats };
  } catch (err) {
    console.error("Fallo el envío", notifId, err);
    await ref.update({ status: "failed", finishedAt: FieldValue.serverTimestamp(), error: "Error interno al enviar" });
    return { status: "failed", stats };
  }
}
