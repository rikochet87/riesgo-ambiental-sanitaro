"""Tarjeta para compartir el link en redes sociales: img/compartir.png (1200x630).

El dibujo es el mosaico real de los radios censales 2022 del Gran Resistencia
(datos/radios). La tarjeta se arma en HTML y se fotografía con Chromium.

Uso, desde la carpeta del proyecto:
    pip install playwright pillow
    playwright install chromium
    python diseno/tarjeta/generar.py

Esta carpeta no se publica (ver .vercelignore); solo se publica el PNG.
"""
import io
import json
import math
import pathlib

from PIL import Image
from playwright.sync_api import sync_playwright

AQUI = pathlib.Path(__file__).resolve().parent
RAIZ = AQUI.parents[1]
RADIOS = RAIZ / 'datos' / 'radios' / 'radios_gran_resistencia_2022.geojson'
SALIDA = RAIZ / 'img' / 'compartir.png'

ANCHO, ALTO = 1200, 630

# Encuadre del mapa: centro del área urbana y escala en píxeles por kilómetro
LON0, LAT0 = -58.968, -27.462
PX_POR_KM = 33.0
CENTRO_X, CENTRO_Y = 905, 300
KM_POR_GRADO_LAT = 110.57
KM_POR_GRADO_LON = 111.32 * math.cos(math.radians(LAT0))  # ~11 % menos que la latitud acá


def proyectar(lon, lat):
    x = CENTRO_X + (lon - LON0) * KM_POR_GRADO_LON * PX_POR_KM
    y = CENTRO_Y - (lat - LAT0) * KM_POR_GRADO_LAT * PX_POR_KM
    return x, y


def anillos(geometria):
    if geometria['type'] == 'Polygon':
        return geometria['coordinates']
    return [anillo for poligono in geometria['coordinates'] for anillo in poligono]


def trazo(anillo, tolerancia=0.7):
    """Anillo proyectado como comando SVG, sin vértices a menos de 0,7 px del anterior."""
    puntos, ultimo = [], None
    for lon, lat, *_ in anillo:
        x, y = proyectar(lon, lat)
        if ultimo is None or math.hypot(x - ultimo[0], y - ultimo[1]) >= tolerancia:
            puntos.append((x, y))
            ultimo = (x, y)
    if len(puntos) < 3:
        return ''
    xs = [p[0] for p in puntos]
    ys = [p[1] for p in puntos]
    if max(xs) < -20 or min(xs) > ANCHO + 20 or max(ys) < -20 or min(ys) > ALTO + 20:
        return ''  # fuera de la tarjeta
    return 'M' + 'L'.join(f'{x:.1f} {y:.1f}' for x, y in puntos) + 'Z'


def mapa_svg():
    datos = json.loads(RADIOS.read_text(encoding='utf-8'))
    urbanos, resto = [], []
    for f in datos['features']:
        d = ''.join(trazo(a) for a in anillos(f['geometry']))
        if d:
            (urbanos if f['properties'].get('TIPO') == 'U' else resto).append(d)
    return f'''
<svg class="mapa" viewBox="0 0 {ANCHO} {ALTO}" width="{ANCHO}" height="{ALTO}" aria-hidden="true">
  <defs>
    <linearGradient id="desvanecer" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0.43" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.66" stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <mask id="mascara"><rect width="{ANCHO}" height="{ALTO}" fill="url(#desvanecer)"/></mask>
  </defs>
  <g mask="url(#mascara)" fill-rule="evenodd">
    <path d="{''.join(resto)}" fill="none" stroke="#61794f" stroke-width="0.9" stroke-opacity="0.6"/>
    <!-- Solo líneas: un relleno casi del color del fondo, al desvanecerse, se ve en escalones -->
    <path d="{''.join(urbanos)}" fill="none" stroke="#b6cc9c" stroke-width="0.65" stroke-opacity="0.8"/>
  </g>
</svg>'''


PIN = ('<svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true">'
       '<circle cx="16" cy="16" r="15" fill="#c9a24a"/>'
       '<path d="M16 7c-3.6 0-6.5 2.8-6.5 6.4 0 4.9 6.5 11.6 6.5 11.6s6.5-6.7 6.5-11.6C22.5 9.8 19.6 7 16 7zm0 9'
       'a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2z" fill="#2f3d2c"/></svg>')


def html():
    return f'''<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<style>
  @font-face {{ font-family: Archivo; src: url(tipografia/archivo-latin-wdth-normal.woff2) format('woff2-variations');
               font-weight: 100 900; font-stretch: 62% 125%;
               unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F; }}
  @font-face {{ font-family: Archivo; src: url(tipografia/archivo-latin-ext-wdth-normal.woff2) format('woff2-variations');
               font-weight: 100 900; font-stretch: 62% 125%; unicode-range: U+0100-024F, U+1E00-1EFF; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; width: {ANCHO}px; height: {ALTO}px; position: relative; overflow: hidden;
         background: #2f3d2c; color: #f1f3ec; font-family: Archivo, sans-serif; }}
  .mapa {{ position: absolute; inset: 0; }}
  .texto {{ position: absolute; left: 76px; top: 70px; width: 600px; }}
  .marca {{ display: flex; align-items: center; gap: 14px; }}
  .marca b {{ display: block; font-size: 24px; font-weight: 800; font-stretch: 110%; letter-spacing: .005em; }}
  .marca span {{ display: block; font-size: 17px; color: #cfd8c4; margin-top: 2px; }}
  h1 {{ margin: 62px 0 22px; font-size: 76px; line-height: .97; font-weight: 800; font-stretch: 112%;
        letter-spacing: -.012em; }}
  .bajada {{ margin: 0; font-size: 26px; line-height: 1.36; color: #d6dfcb; max-width: 25em; font-stretch: 98%; }}
  .semaforo {{ display: flex; gap: 26px; margin-top: 34px; font-size: 18px; color: #cfd8c4; }}
  .semaforo span {{ display: flex; align-items: center; gap: 9px; }}
  .semaforo i {{ width: 13px; height: 13px; border-radius: 50%; box-shadow: 0 0 0 3px rgba(255,255,255,.1); }}
  .url {{ position: absolute; left: 76px; bottom: 50px; font-size: 21px; font-weight: 650;
          color: #c9a24a; letter-spacing: .01em; }}
  .borde {{ position: absolute; left: 0; right: 0; bottom: 0; height: 7px; background: #c9a24a; }}
</style></head>
<body>
  {mapa_svg()}
  <div class="texto">
    <div class="marca">{PIN}<div><b>Basurales</b><span>Gran Resistencia, Chaco</span></div></div>
    <h1>Mapa vecinal<br>de basurales</h1>
    <p class="bajada">Denunciá desde el celular, sin crear una cuenta, y conocé el riesgo ambiental y sanitario de cada punto.</p>
    <div class="semaforo">
      <span><i style="background:#d64a3a"></i>Activo</span>
      <span><i style="background:#d9a43c"></i>En gestión</span>
      <span><i style="background:#7fae55"></i>Resuelto</span>
    </div>
  </div>
  <div class="url">riesgo-ambiental-sanitaro.vercel.app</div>
  <div class="borde"></div>
</body></html>'''


def main():
    pagina = AQUI / 'tarjeta.html'
    pagina.write_text(html(), encoding='utf-8')
    with sync_playwright() as p:
        nav = p.chromium.launch()
        hoja = nav.new_page(viewport={'width': ANCHO, 'height': ALTO}, device_scale_factor=1)
        hoja.goto(pagina.as_uri())
        hoja.evaluate('document.fonts.ready')
        crudo = hoja.screenshot(type='png')
        nav.close()

    # Paleta de 256 colores: la imagen es de colores planos y así pesa poco
    # (WhatsApp no muestra la vista previa si la imagen es muy pesada).
    # Octree y no median cut: median cut se come los colores que ocupan poca
    # superficie, y los puntos del semáforo salían ocres en vez de rojo y verde.
    imagen = Image.open(io.BytesIO(crudo)).convert('RGB')
    imagen = imagen.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    SALIDA.parent.mkdir(exist_ok=True)
    imagen.save(SALIDA, optimize=True)
    print(f'{SALIDA.relative_to(RAIZ)}: {SALIDA.stat().st_size / 1024:.0f} KB')


if __name__ == '__main__':
    main()
