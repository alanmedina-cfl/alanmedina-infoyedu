// Función programada de Netlify: envía las notificaciones agendadas cuyo sendAt ya venció.
// Las funciones programadas solo se ejecutan en el deploy de PRODUCCIÓN publicado.
import { services, Timestamp } from "./_lib/firebase.mjs";
import { dispatch } from "./_lib/dispatch.mjs";

export default async () => {
  const { db } = services();
  const due = await db
    .collection("notifications")
    .where("status", "==", "scheduled")
    .where("sendAt", "<=", Timestamp.now())
    .limit(5)
    .get();

  for (const doc of due.docs) {
    await dispatch(doc.id); // idempotente: reclama el documento con una transacción
  }
  console.log(`dispatch-scheduled: ${due.size} notificaciones procesadas`);
};

export const config = { schedule: "*/5 * * * *" };
