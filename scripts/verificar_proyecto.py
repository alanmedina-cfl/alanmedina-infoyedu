#!/usr/bin/env python3
"""Verifica un proyecto Netlify + Firebase + Web Push antes de entregarlo o desplegarlo.

Uso:  python3 verificar_proyecto.py <carpeta-del-proyecto>

Comprueba (ERROR = bloquea la entrega, AVISO = revisar):
  - No hay secretos ni claves privadas en public/ ni en el repositorio.
  - No se usan APIs de FCM retiradas (legacy HTTP, server key, sendToDevice, sendMulticast...).
  - Las reglas de Firestore no están abiertas ("allow ... if true").
  - Las funciones administrativas verifican token y claim admin.
  - manifest.json válido con iconos existentes; sw.js presente y sin redirección catch-all.
  - Sin innerHTML con contenido dinámico en el panel; sin scripts inline (compatibilidad con la CSP).
Código de salida: 0 sin errores, 1 con errores.
"""
import json
import re
import sys
from pathlib import Path

errores, avisos = [], []
err = errores.append
warn = avisos.append

raiz = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
if not raiz.is_dir():
    sys.exit(f"No existe la carpeta: {raiz}")

IGNORAR = {"node_modules", ".git", ".netlify"}


def archivos(patron):
    return [p for p in raiz.rglob(patron) if not (set(p.parts) & IGNORAR) and p.is_file()]


def texto(p):
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


publico = raiz / "public"
if not publico.is_dir():
    err("Falta la carpeta public/ (publish de Netlify).")

# ---------------------------------------------------------------- Secretos
PATRONES_SECRETO = [
    (r"-----BEGIN (RSA |EC )?PRIVATE KEY-----", "clave privada"),
    (r'"private_key"\s*:', "JSON de service account"),
    (r'"type"\s*:\s*"service_account"', "JSON de service account"),
    (r"AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{100,}", "server key legacy de FCM"),
]
for p in archivos("*"):
    if p.suffix.lower() in {".png", ".ico", ".jpg", ".webp", ".zip", ".lock"} or p.name in {".env.example", "verificar_proyecto.py"}:
        continue
    t = texto(p)
    rel = p.relative_to(raiz)
    for rx, nombre in PATRONES_SECRETO:
        # El script set-admin y los .mjs leen la clave de process.env: eso no es un secreto embebido
        if re.search(rx, t) and "process.env" not in t.split("-----BEGIN")[0][-200:]:
            err(f"{rel}: posible {nombre} dentro del proyecto.")
for p in archivos(".env*"):
    if p.name != ".env.example":
        warn(f"{p.relative_to(raiz)}: archivo .env presente; confirmá que está en .gitignore y no se sube.")
gi = raiz / ".gitignore"
if not gi.exists() or ".env" not in texto(gi):
    err(".gitignore no excluye .env.")
for p in archivos("*adminsdk*.json") + archivos("serviceAccount*.json"):
    err(f"{p.relative_to(raiz)}: credencial de service account dentro del proyecto.")

# ---------------------------------------------------------------- APIs retiradas
OBSOLETO = [
    (r"fcm\.googleapis\.com/fcm/send", "endpoint HTTP legacy de FCM"),
    (r"\bsendToDevice\b|\bsendToDeviceGroup\b|\bsendToTopic\b|\bsendToCondition\b", "API legacy sendTo*"),
    (r"\bsendMulticast\b|\bsendAll\b", "sendMulticast/sendAll (retiradas; usar sendEach / sendEachForMulticast)"),
    (r"Authorization['\"]?\s*:\s*['\"`]key=", "cabecera 'key=' (server key legacy)"),
    (r"\bgcm_sender_id\b|\bgcm\.googleapis", "GCM"),
    (r"messaging\(\)\.usePublicVapidKey|\.requestPermission\(\)\.then\([^)]*getToken\(\)", "API de FCM web obsoleta"),
    (r"firebase-messaging-sw\.js.*importScripts\([^)]*firebasejs/(?:[1-8]\.|9\.[0-9]\.)", "SDK de FCM antiguo en el Service Worker"),
]
for p in archivos("*"):
    if p.suffix not in {".js", ".mjs", ".html", ".json", ".toml"}:
        continue
    t = texto(p)
    for rx, nombre in OBSOLETO:
        if re.search(rx, t):
            err(f"{p.relative_to(raiz)}: usa {nombre}.")

# ---------------------------------------------------------------- Firestore rules
reglas = raiz / "firestore.rules"
if not reglas.exists():
    err("Falta firestore.rules.")
else:
    t = texto(reglas)
    if re.search(r"allow\s+[^;]*:\s*if\s+true\s*;", t):
        err("firestore.rules: contiene 'allow ... if true' (acceso abierto).")
    if "token.admin" not in t:
        warn("firestore.rules: no se ve el uso del custom claim admin.")
    if re.search(r"match\s+/devices", t) and "request.auth.uid" not in t:
        err("firestore.rules: la colección devices no limita el acceso por uid.")

# ---------------------------------------------------------------- Funciones
funciones = raiz / "netlify" / "functions"
if funciones.is_dir():
    sensibles = {"send-notification.mjs", "prune-devices.mjs"}
    for f in sensibles:
        p = funciones / f
        if p.exists() and "requireAdmin" not in texto(p):
            err(f"netlify/functions/{f}: no llama a requireAdmin().")
    lib = funciones / "_lib" / "firebase.mjs"
    if lib.exists():
        t = texto(lib)
        if "verifyIdToken" not in t or "admin !== true" not in t:
            err("_lib/firebase.mjs: requireAdmin debe verificar el ID token y el claim admin.")
    for p in funciones.rglob("*.mjs"):
        if "Access-Control-Allow-Origin" in texto(p) and "*" in texto(p):
            warn(f"{p.relative_to(raiz)}: CORS abierto con '*'.")
else:
    warn("No existe netlify/functions (¿envío desde Cloud Functions?).")

# ---------------------------------------------------------------- PWA
mani = publico / "manifest.json"
if mani.exists():
    try:
        m = json.loads(texto(mani))
        for campo in ["name", "short_name", "start_url", "display", "icons", "theme_color", "background_color"]:
            if campo not in m:
                err(f"manifest.json: falta '{campo}'.")
        tamanios = set()
        for ic in m.get("icons", []):
            src = ic.get("src", "")
            if not (publico / src.lstrip("/")).exists():
                err(f"manifest.json: el icono {src} no existe en public/.")
            tamanios.add(ic.get("sizes"))
        if not {"192x192", "512x512"} <= tamanios:
            err("manifest.json: se necesitan iconos 192x192 y 512x512.")
        if not any(i.get("purpose") == "maskable" for i in m.get("icons", [])):
            warn("manifest.json: sin icono maskable.")
    except json.JSONDecodeError as e:
        err(f"manifest.json inválido: {e}")
elif publico.is_dir():
    err("Falta public/manifest.json.")

sw = publico / "sw.js"
if not sw.exists():
    err("Falta public/sw.js (Service Worker con Firebase Messaging).")
else:
    t = texto(sw)
    for necesario in ["onBackgroundMessage", "notificationclick", "showNotification"]:
        if necesario not in t:
            err(f"sw.js: falta {necesario}.")
    v = re.findall(r"firebasejs/([0-9.]+)/", t)
    if len(set(v)) > 1:
        err(f"sw.js: versiones distintas del SDK en importScripts: {sorted(set(v))}.")
    jsf = publico / "js" / "firebase.js"
    if jsf.exists():
        vf = set(re.findall(r"firebasejs/([0-9.]+)/", texto(jsf)))
        if v and vf and set(v) != vf:
            warn(f"Versión del SDK en sw.js {sorted(set(v))} distinta de js/firebase.js {sorted(vf)} (deberían coincidir).")
cfg = publico / "firebase-config.js"
if cfg.exists() and "REEMPLAZAR" in texto(cfg):
    warn("public/firebase-config.js aún tiene valores 'REEMPLAZAR'.")

toml = raiz / "netlify.toml"
if not toml.exists():
    err("Falta netlify.toml.")
else:
    t = texto(toml)
    if "publish" not in t:
        err("netlify.toml: falta 'publish'.")
    if re.search(r'from\s*=\s*"/\*"\s*\n\s*to\s*=\s*"/index\.html"', t):
        err("netlify.toml: redirección catch-all a /index.html (rompe sw.js, manifest, iconos y /api).")
    if "Content-Security-Policy" not in t:
        warn("netlify.toml: sin Content-Security-Policy.")
    if "/sw.js" not in t:
        warn("netlify.toml: sin cabecera no-cache para /sw.js.")

# ---------------------------------------------------------------- Frontend seguro
for p in archivos("*.html"):
    t = texto(p)
    if re.search(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", t):
        err(f"{p.relative_to(raiz)}: script inline (bloqueado por la CSP).")
    if re.search(r'\sstyle="', t) or re.search(r"<style", t):
        warn(f"{p.relative_to(raiz)}: estilos inline (bloqueados por la CSP 'style-src self').")
for p in archivos("*.js"):
    t = texto(p)
    if re.search(r"\.innerHTML\s*=|\.insertAdjacentHTML\(|document\.write\(", t) and "node_modules" not in str(p):
        err(f"{p.relative_to(raiz)}: usa innerHTML/insertAdjacentHTML/document.write (riesgo de inyección).")
    if re.search(r"\beval\(|new Function\(", t):
        err(f"{p.relative_to(raiz)}: usa eval/new Function.")
for p in (publico.rglob("*.js") if publico.is_dir() else []):
    if re.search(r"firebase-admin|FIREBASE_PRIVATE_KEY", texto(p)):
        err(f"{p.relative_to(raiz)}: referencia a Admin SDK/clave privada en código público.")

# ---------------------------------------------------------------- Resultado
for a in avisos:
    print("AVISO:", a)
for e in errores:
    print("ERROR:", e)
print(f"\n{len(errores)} error(es), {len(avisos)} aviso(s).")
sys.exit(1 if errores else 0)
