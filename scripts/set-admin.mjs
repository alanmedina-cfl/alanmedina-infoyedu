// Asigna (o quita) el custom claim "admin" a un usuario de Firebase Authentication.
// Se ejecuta SOLO en tu computadora, con las credenciales de servicio en variables de entorno.
//
//   1) Creá el usuario en Firebase Console -> Authentication -> Users -> Add user (correo + contraseña)
//   2) Cargá las variables y ejecutá:
//        node --env-file=.env scripts/set-admin.mjs admin@tudominio.com
//        node --env-file=.env scripts/set-admin.mjs admin@tudominio.com --revoke
//   3) La persona debe cerrar sesión y volver a entrar para recibir el claim nuevo.
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const [email, flag] = process.argv.slice(2);
if (!email) {
  console.error("Uso: node --env-file=.env scripts/set-admin.mjs <correo> [--revoke]");
  process.exit(1);
}

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
});

const auth = getAuth();
const user = await auth.getUserByEmail(email);
const makeAdmin = flag !== "--revoke";
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: makeAdmin });
await auth.revokeRefreshTokens(user.uid); // fuerza a renovar el token con el claim nuevo
console.log(`${makeAdmin ? "Administrador asignado" : "Administrador revocado"}: ${email} (uid ${user.uid})`);
