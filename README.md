# Alan Medina — Informática y Educación (PWA + notificaciones)

- **App instalable (PWA):** al abrirla instalada, redirige al instante a https://alanmedinainfoyedu.mitiendanube.com/
- **Panel `/admin`:** acceso con correo + contraseña (Firebase Authentication) para enviar notificaciones push.
- **Backend:** Netlify Functions + Firebase Admin SDK (FCM). Sin claves privadas en el frontend.

## Cómo se comporta la app

| Situación | Qué pasa |
|---|---|
| Primera vez en la app instalada | Pantalla de bienvenida: **Activar avisos y entrar a la tienda** / **Entrar sin avisos** |
| Siguientes aperturas (app instalada) | Redirección instantánea a la tienda |
| Pestaña normal del navegador | No redirige: permite instalar y activar avisos (botón "Ir a la tienda") |
| `https://TU-SITIO.netlify.app/?setup` | Fuerza la pantalla de configuración (para reactivar avisos o probar) |
| Sin internet | No redirige; muestra aviso y entra a la tienda al volver la conexión |

El token de avisos se renueva en segundo plano como máximo una vez por semana (esa apertura puede tardar hasta ~4 s en redirigir).

## Puesta en marcha (una sola vez)

1. **Firebase** (console.firebase.google.com): crear proyecto → *Authentication* → habilitar **Anónimo** y **Correo/Contraseña** → crear *Firestore* → publicar `firestore.rules` e índices de `firestore.indexes.json`.
2. **Configuración web:** *Project settings → Your apps → Web* → copiar los valores a `public/firebase-config.js`. En *Cloud Messaging → Web Push certificates* generar la clave **VAPID** y pegarla en `FCM_VAPID_KEY`.
3. **Cuenta de servicio:** *Project settings → Service accounts → Generate new private key*. **No la subas a Git.**
4. **Netlify:** subir el proyecto a GitHub → *Import project* (publish `public`, sin build). Cargar variables de entorno (alcance *Functions*, marcar secretas): `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`. Opcional: `STORE_URL`. Hacer nuevo deploy.
5. **Autorizar dominio:** Firebase → Authentication → Settings → *Authorized domains* → agregar `TU-SITIO.netlify.app`.
6. **Crear tu usuario admin:** en Firebase → Authentication → *Add user* (correo y contraseña). Luego, en local con las variables de entorno:
   ```bash
   npm install
   node scripts/set-admin.mjs tu@correo.com
   ```
   Cerrá sesión y volvé a entrar en `/admin` para que tome el permiso.

## Probar

1. Abrí `https://TU-SITIO.netlify.app/` en el celular → instalar → abrir desde el ícono → **Activar avisos y entrar a la tienda**.
2. Cerrá la app y volvé a abrirla: debe entrar directo a la tienda.
3. En `/admin` iniciá sesión → **Enviar** → "Todos los dispositivos".

## Notas honestas

- **iPhone/iPad:** los avisos exigen iOS/iPadOS 16.4+ y la app agregada a la pantalla de inicio (Safari → Compartir → Agregar a pantalla de inicio).
- La tienda es un sitio externo: al redirigir, Android puede mostrar una barra superior con la dirección y iOS abre la tienda dentro de la app. Es un comportamiento del sistema.
- "Aceptadas por FCM" no equivale a "mostradas" ni "leídas".
- Las notificaciones solo pueden apuntar a este sitio o a la tienda (`STORE_URL`); otros dominios se rechazan.
- Verificación: `python3 scripts/verificar_proyecto.py .` (0 errores; el único aviso es completar `REEMPLAZAR` en `firebase-config.js`).
