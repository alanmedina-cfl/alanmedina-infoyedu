#!/usr/bin/env python3
"""Genera los iconos de una PWA como archivos planos en una carpeta.

Salida: favicon.ico, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png

Uso:
  python3 generar_iconos.py <carpeta> [--bg "#0f1117"] [--accent "#00e5a0"]
                            [--motivo dado|circulo|anillo|cuadrado|letra] [--letra S]

Los iconos "maskable" y de iOS llevan el fondo a sangre y el motivo dentro de la zona
segura (Android los recorta en círculo o squircle); los demás llevan esquinas redondeadas.
"""
import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Falta Pillow. Instalalo con: pip install pillow --break-system-packages")

FUENTES = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
           "/System/Library/Fonts/Helvetica.ttc", "C:/Windows/Fonts/arialbd.ttf"]


def color(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def dibujar(size, a_sangre, bg, ac, motivo, letra):
    S = size * 4  # se dibuja a 4x y se reduce: bordes suaves
    im = Image.new("RGBA", (S, S), bg if a_sangre else (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    if not a_sangre:
        dr.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.1875), fill=bg)
    d = S * (0.44 if a_sangre else 0.50)  # lado del motivo; 0.44 cabe en la zona segura (80 %)
    x0 = y0 = (S - d) / 2
    c = S / 2

    if motivo == "dado":
        dr.rounded_rectangle((x0, y0, x0 + d, y0 + d), radius=d * 0.2, fill=ac)
        r = d * 0.085
        for ox, oy in [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)]:  # cara del 5
            cx, cy = c + ox * d * 0.26, c + oy * d * 0.26
            dr.ellipse((cx - r, cy - r, cx + r, cy + r), fill=bg)
    elif motivo == "circulo":
        dr.ellipse((x0, y0, x0 + d, y0 + d), fill=ac)
    elif motivo == "anillo":
        dr.ellipse((x0, y0, x0 + d, y0 + d), fill=ac)
        m = d * 0.24
        dr.ellipse((x0 + m, y0 + m, x0 + d - m, y0 + d - m), fill=bg)
    elif motivo == "cuadrado":
        dr.rounded_rectangle((x0, y0, x0 + d, y0 + d), radius=d * 0.15, fill=ac)
    elif motivo == "letra":
        fuente = next((f for f in FUENTES if Path(f).exists()), None)
        if fuente:
            dr.text((c, c), letra[:1].upper(), font=ImageFont.truetype(fuente, int(d * 1.1)), fill=ac, anchor="mm")
        else:
            dr.ellipse((x0, y0, x0 + d, y0 + d), fill=ac)
    return im.resize((size, size), Image.LANCZOS)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("carpeta")
    p.add_argument("--bg", default="#0f1117")
    p.add_argument("--accent", default="#00e5a0")
    p.add_argument("--motivo", default="circulo", choices=["dado", "circulo", "anillo", "cuadrado", "letra"])
    p.add_argument("--letra", default="J")
    a = p.parse_args()

    out = Path(a.carpeta)
    out.mkdir(parents=True, exist_ok=True)
    bg, ac = color(a.bg), color(a.accent)
    hacer = lambda size, sangre: dibujar(size, sangre, bg, ac, a.motivo, a.letra)

    hacer(192, False).save(out / "icon-192.png")
    hacer(512, False).save(out / "icon-512.png")
    hacer(512, True).save(out / "icon-maskable-512.png")
    hacer(180, True).save(out / "apple-touch-icon.png")
    hacer(256, False).save(out / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    for n in ["favicon.ico", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]:
        print("OK", out / n)


if __name__ == "__main__":
    main()
