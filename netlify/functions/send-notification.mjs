// POST /api/send-notification  (solo administradores)
// Cabecera: Authorization: Bearer <Firebase ID token>
// Cuerpo: { title, body, url?, icon?, image?, audience:{type:"all"|"uids"|"groups",...}, sendAt? }
import { services, requireAdmin, readJson, json, errorResponse, httpError, FieldValue, Timestamp } from "./_lib/firebase.mjs";
import { validateNotification } from "./_lib/validate.mjs";
import { dispatch } from "./_lib/dispatch.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });
  try {
    const admin = await requireAdmin(req); // 1) autenticación + autorización en backend
    const notif = validateNotification(await readJson(req)); // 2) validación estricta
    const { db } = services();

    // 3) límite de envíos por administrador (anti-abuso / anti-error humano)
    const max = Number(process.env.MAX_SENDS_PER_MINUTE || 5);
    const recent = await db
      .collection("notifications")
      .where("createdBy", "==", admin.uid)
      .where("createdAt", ">", Timestamp.fromMillis(Date.now() - 60_000))
      .count()
      .get();
    if (recent.data().count >= max) throw httpError(429, "Demasiados envíos seguidos. Esperá un minuto.");

    // 4) registrar y enviar
    const ref = db.collection("notifications").doc();
    await ref.set({
      title: notif.title,
      body: notif.body,
      url: notif.url,
      icon: notif.icon,
      image: notif.image,
      audience: notif.audience,
      sendAt: notif.sendAt ? Timestamp.fromDate(notif.sendAt) : null,
      status: notif.sendAt ? "scheduled" : "queued",
      createdBy: admin.uid,
      createdByEmail: admin.email || null,
      createdAt: FieldValue.serverTimestamp(),
      stats: { recipients: 0, accepted: 0, rejected: 0, invalidRemoved: 0, shown: 0, clicked: 0 },
    });

    if (notif.sendAt) return json(202, { id: ref.id, status: "scheduled" });
    const result = await dispatch(ref.id);
    return json(200, { id: ref.id, ...result });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config = { path: "/api/send-notification" };
