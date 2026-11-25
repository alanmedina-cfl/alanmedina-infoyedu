// Panel de administración. La seguridad REAL está en el servidor:
//  - Firestore Rules (lecturas solo con claim admin) y
//  - Netlify Functions (verifican el ID token y el claim en cada operación).
// Esta interfaz solo mejora la experiencia: ocultar o mostrar pantallas no protege nada.
import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, getIdTokenResult,
  collection, doc, query, orderBy, limit, where, onSnapshot, getDocs, getCountFromServer, setDoc, deleteDoc, serverTimestamp,
} from "../js/firebase.js";

const $ = (id) => document.getElementById(id);

/** Crea elementos con textContent: NUNCA se inserta contenido externo con innerHTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...children.flat().map((c) => (c instanceof Node ? c : document.createTextNode(String(c ?? "")))));
  return el;
}
const fmtDate = (ts) => (ts?.toDate ? ts.toDate().toLocaleString() : "—");
const setMsg = (el, text, cls = "") => { el.textContent = text; el.className = `msg ${cls}`; };

// ------------------------------------------------------------------ Sesión
let unsubscribers = [];

onAuthStateChanged(auth, async (user) => {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  if (!user || user.isAnonymous) return showLogin();
  const token = await getIdTokenResult(user, true);
  if (token.claims.admin !== true) {
    setMsg($("login-msg"), "Esta cuenta no tiene permisos de administrador.", "error");
    await signOut(auth);
    return;
  }
  showPanel(user);
});

function showLogin() {
  $("view-panel").hidden = true;
  $("view-login").hidden = false;
}

function showPanel(user) {
  $("view-login").hidden = true;
  $("view-panel").hidden = false;
  $("who").textContent = user.email;
  watchHistory();
  watchTemplates();
  loadDevices();
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg($("login-msg"), "Verificando…");
  try {
    await signInWithEmailAndPassword(auth, $("login-email").value.trim(), $("login-pass").value);
    setMsg($("login-msg"), "");
  } catch {
    setMsg($("login-msg"), "Correo o contraseña incorrectos.", "error"); // mensaje genérico a propósito
  }
});

$("btn-reset").addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  if (!email) return setMsg($("login-msg"), "Escribí tu correo y volvé a tocar el botón.", "error");
  await sendPasswordResetEmail(auth, email).catch(() => {});
  setMsg($("login-msg"), "Si el correo existe, recibirás un enlace para restablecer la contraseña.", "ok");
});

$("btn-logout").addEventListener("click", () => signOut(auth));

// ------------------------------------------------------------------ Pestañas
document.querySelectorAll("[data-tab]").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
    ["send", "history", "devices", "templates"].forEach((t) => ($(`tab-${t}`).hidden = t !== btn.dataset.tab));
  }),
);

// ------------------------------------------------------------------ Llamadas al backend
async function api(path, payload) {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ------------------------------------------------------------------ Enviar
const countInput = (input, out) => input.addEventListener("input", () => (out.textContent = input.value.length));
countInput($("send-title"), $("cnt-title"));
countInput($("send-body"), $("cnt-body"));

document.querySelectorAll("input[name=aud]").forEach((r) =>
  r.addEventListener("change", () => {
    const v = document.querySelector("input[name=aud]:checked").value;
    $("aud-groups").hidden = v !== "groups";
    $("aud-uids").hidden = v !== "uids";
  }),
);

function buildAudience() {
  const type = document.querySelector("input[name=aud]:checked").value;
  if (type === "groups") {
    return { type, groups: [...$("aud-groups").querySelectorAll("input:checked")].map((i) => i.value) };
  }
  if (type === "uids") {
    return { type, uids: $("aud-uids").value.split(/\s+/).map((s) => s.trim()).filter(Boolean) };
  }
  return { type: "all" };
}

$("form-send").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("send-msg");
  const payload = {
    title: $("send-title").value,
    body: $("send-body").value,
    url: $("send-url").value,
    icon: $("send-icon").value,
    image: $("send-image").value,
    audience: buildAudience(),
  };
  if ($("send-at").value) payload.sendAt = new Date($("send-at").value).toISOString();

  const audienceText = { all: "TODOS los dispositivos", groups: "los grupos seleccionados", uids: "los usuarios indicados" }[payload.audience.type];
  const when = payload.sendAt ? `programada para ${new Date(payload.sendAt).toLocaleString()}` : "ahora mismo";
  if (!confirm(`¿Enviar “${payload.title}” a ${audienceText}, ${when}?`)) return;

  $("btn-send").disabled = true;
  setMsg(msg, "Enviando…");
  try {
    const r = await api("/api/send-notification", payload);
    if (r.status === "scheduled") setMsg(msg, "Notificación programada.", "ok");
    else setMsg(msg, `Estado: ${r.status}. Destinatarios: ${r.stats?.recipients ?? 0}, aceptadas por FCM: ${r.stats?.accepted ?? 0}, rechazadas: ${r.stats?.rejected ?? 0}.`, "ok");
    e.target.reset();
    $("cnt-title").textContent = $("cnt-body").textContent = "0";
  } catch (err) {
    setMsg(msg, err.message, "error");
  } finally {
    $("btn-send").disabled = false;
  }
});

// ------------------------------------------------------------------ Historial
function watchHistory() {
  const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(50));
  unsubscribers.push(
    onSnapshot(q, (snap) => {
      const body = $("history-body");
      body.replaceChildren(
        ...snap.docs.map((d) => {
          const n = d.data();
          const s = n.stats || {};
          return h("tr", { class: "click", tabindex: "0", onclick: () => openDetail(d.id, n) },
            h("td", {}, fmtDate(n.createdAt)),
            h("td", {}, n.title),
            h("td", {}, h("span", { class: `badge ${n.status}` }, n.status)),
            h("td", {}, s.recipients ?? 0),
            h("td", {}, s.accepted ?? 0),
            h("td", {}, s.shown ?? 0),
            h("td", {}, s.clicked ?? 0));
        }),
      );
    }, (err) => console.error("Historial", err)),
  );
}

async function openDetail(id, n) {
  $("detail-title").textContent = n.title;
  const s = n.stats || {};
  const logs = await getDocs(query(collection(db, "notification_logs"), where("notificationId", "==", id), orderBy("createdAt", "asc")));
  $("detail-body").replaceChildren(
    h("p", {}, n.body),
    h("p", { class: "muted" }, `Estado: ${n.status} · Creada: ${fmtDate(n.createdAt)} · Por: ${n.createdByEmail || "—"}`),
    h("p", { class: "muted" }, `Destino: ${n.url} · Audiencia: ${JSON.stringify(n.audience)}`),
    h("div", { class: "stats" },
      ...[["Destinatarios", s.recipients], ["Aceptadas por FCM", s.accepted], ["Rechazadas", s.rejected],
        ["Tokens eliminados", s.invalidRemoved], ["Mostradas (aprox.)", s.shown], ["Clics (aprox.)", s.clicked]]
        .map(([label, value]) => h("div", { class: "stat" }, h("b", {}, value ?? 0), label))),
    n.errorCounts ? h("p", { class: "muted" }, `Errores FCM: ${JSON.stringify(n.errorCounts)}`) : "",
    h("p", { class: "muted" }, `Lotes de envío: ${logs.size}`),
  );
  $("dlg-detail").showModal();
}
$("detail-close").addEventListener("click", () => $("dlg-detail").close());

// ------------------------------------------------------------------ Dispositivos
async function loadDevices() {
  const [users, devices, granted] = await Promise.all([
    getCountFromServer(collection(db, "users")),
    getCountFromServer(collection(db, "devices")),
    getCountFromServer(query(collection(db, "devices"), where("permission", "==", "granted"))),
  ]);
  $("device-stats").replaceChildren(
    ...[["Usuarios registrados", users.data().count], ["Dispositivos (tokens)", devices.data().count], ["Con permiso activo", granted.data().count]]
      .map(([label, v]) => h("div", { class: "stat" }, h("b", {}, v), label)),
  );

  const snap = await getDocs(query(collection(db, "devices"), orderBy("lastSeenAt", "desc"), limit(50)));
  $("devices-body").replaceChildren(
    ...snap.docs.map((d) => {
      const v = d.data();
      return h("tr", {},
        h("td", {}, v.platform),
        h("td", {}, (v.groups || []).join(", ") || "—"),
        h("td", {}, fmtDate(v.lastSeenAt)),
        h("td", {}, `${String(v.token).slice(0, 12)}…`), // nunca se muestra el token completo
        h("td", {}, h("button", { class: "danger", onclick: async () => {
          if (confirm("¿Eliminar este dispositivo?")) { await deleteDoc(doc(db, "devices", d.id)); loadDevices(); }
        } }, "Eliminar")));
    }),
  );
}
$("btn-refresh-devices").addEventListener("click", loadDevices);

$("btn-prune").addEventListener("click", async () => {
  const msg = $("devices-msg");
  setMsg(msg, "Revisando tokens…");
  try {
    const dry = await api("/api/prune-devices", { dryRun: true });
    const total = dry.stale + dry.invalid;
    if (!total) return setMsg(msg, `Revisados ${dry.scanned}: no hay tokens inválidos ni obsoletos.`, "ok");
    if (!confirm(`Se encontraron ${dry.invalid} inválidos y ${dry.stale} obsoletos. ¿Eliminarlos?`)) return setMsg(msg, "Cancelado.");
    const real = await api("/api/prune-devices", { dryRun: false });
    setMsg(msg, `Eliminados: ${real.deleted}. ${real.note || ""}`, "ok");
    loadDevices();
  } catch (err) {
    setMsg(msg, err.message, "error");
  }
});

// ------------------------------------------------------------------ Plantillas
function watchTemplates() {
  unsubscribers.push(
    onSnapshot(query(collection(db, "templates"), orderBy("name")), (snap) => {
      const select = $("send-template");
      select.replaceChildren(h("option", { value: "" }, "— ninguna —"));
      const rows = [];
      snap.docs.forEach((d) => {
        const t = d.data();
        select.append(h("option", { value: d.id }, t.name));
        rows.push(h("tr", {},
          h("td", {}, t.name), h("td", {}, t.title),
          h("td", {}, h("button", { class: "danger", onclick: () => deleteDoc(doc(db, "templates", d.id)) }, "Borrar"))));
      });
      $("templates-body").replaceChildren(...rows);
      templatesCache = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    }),
  );
}
let templatesCache = {};

$("send-template").addEventListener("change", (e) => {
  const t = templatesCache[e.target.value];
  if (!t) return;
  $("send-title").value = t.title;
  $("send-body").value = t.body;
  $("send-url").value = t.url || "";
  $("cnt-title").textContent = t.title.length;
  $("cnt-body").textContent = t.body.length;
});

$("form-template").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ref = doc(collection(db, "templates"));
  await setDoc(ref, {
    name: $("tpl-name").value.trim(), title: $("tpl-title").value.trim(),
    body: $("tpl-body").value.trim(), url: $("tpl-url").value.trim(), createdAt: serverTimestamp(),
  });
  e.target.reset();
});
