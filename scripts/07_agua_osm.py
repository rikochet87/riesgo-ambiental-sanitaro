# -*- coding: utf-8 -*-
"""
07_agua_osm.py
==============
Completa la capa de agua con OpenStreetMap. La hidrografía del IGN (script 04)
no sirve a escala de ciudad: en el Gran Resistencia solo trae el Paraná, el
Barranqueras, tres lagunas con nombre y espejos del valle del Paraná; ninguna
de sus capas de líneas toca el área, así que faltan el río Negro, los riachos,
los canales y las lagunas urbanas.

Qué hace:
  1. Descarga de Overpass (el mismo servicio que usa QuickOSM) todo lo que en
     el rectángulo de la app tenga:
       natural=water (lagunas, estanques, madrejones, piletas...),
       landuse=reservoir / basin, waterway=riverbank,
       waterway=river / stream / canal / drain / ditch.
     Lo guarda tal cual en datos/hidrografia/osm_agua.osm (con la fecha).
  2. GDAL, que viene con QGIS, arma los polígonos (también las lagunas con
     islas) y las líneas. Se cortan al rectángulo de la app.
  3. Junta OSM con el IGN. Un polígono de OSM que cae en más de un 80 % dentro
     de un polígono del IGN se descarta (es el mismo cuerpo de agua). Las
     líneas de OSM se suman todas: el IGN no tiene líneas acá.

Campos: nombre, tipo (en castellano), regimen (intermitente si OSM lo dice),
capa ("IGN ..." u "OSM ...").

Salidas (en datos/hidrografia/ y copia en COPIAS):
  agua_osm_gran_resistencia.geojson      solo OSM (para revisar en QGIS)
  agua_contexto_gran_resistencia.geojson IGN + OSM, para capa_agua (06)

CÓMO CORRERLO
-------------
En QGIS (necesita internet): Complementos > Consola de Python > Mostrar editor
> abrir este archivo > Ejecutar. Tarda uno o dos minutos. Al terminar agrega
las dos capas al mapa. No hace falta tener QuickOSM instalado.
Para volver a usar una descarga ya hecha sin consultar Overpass, poné
DESCARGAR = False.

Datos de OSM: © colaboradores de OpenStreetMap, licencia ODbL.
"""

import inspect
import json
import os
import runpy
import shutil
import sys
import time
import urllib.parse


def _carpeta_de_este_script():
    ruta = inspect.currentframe().f_code.co_filename
    if ruta.startswith("<"):
        try:
            ruta = __file__
        except NameError:
            raise RuntimeError("No pude saber dónde está el script: abrilo desde el editor de la "
                               "consola de QGIS.")
    return os.path.dirname(os.path.abspath(ruta))


CARPETA_SCRIPTS = _carpeta_de_este_script()
PROYECTO = os.path.dirname(CARPETA_SCRIPTS)
_ARCHIVO_LOCAL = os.path.join(CARPETA_SCRIPTS, "rutas_locales.py")
LOCALES = runpy.run_path(_ARCHIVO_LOCAL) if os.path.exists(_ARCHIVO_LOCAL) else {}

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------
CARPETA = os.path.join(PROYECTO, "datos", "hidrografia")
ARCHIVO_OSM = os.path.join(CARPETA, "osm_agua.osm")
IGN = os.path.join(CARPETA, "agua_gran_resistencia.geojson")          # salida del 04
SALIDA_OSM = os.path.join(CARPETA, "agua_osm_gran_resistencia.geojson")
SALIDA = os.path.join(CARPETA, "agua_contexto_gran_resistencia.geojson")
COPIAS = LOCALES.get("COPIAS", [])
DESCARGAR = True
SOLAPE_REPETIDO = 0.8      # fracción de un polígono OSM dentro del IGN para darlo por repetido

LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = -59.15, -27.62, -58.85, -27.30   # mismo rectángulo que la app
SERVIDORES = ["https://overpass-api.de/api/interpreter",
              "https://overpass.kumi.systems/api/interpreter"]

CURSOS = ("river", "stream", "canal", "drain", "ditch")
TIPO_LINEA = {"river": "Río", "stream": "Arroyo o riacho", "canal": "Canal",
              "drain": "Desagüe a cielo abierto", "ditch": "Zanja"}
TIPO_AGUA = {"lake": "Laguna", "lagoon": "Laguna", "pond": "Estanque o laguna chica",
             "oxbow": "Madrejón", "river": "Río", "canal": "Canal", "reservoir": "Reservorio",
             "basin": "Cuenco o reservorio", "wastewater": "Pileta de tratamiento de efluentes",
             "stream": "Arroyo o riacho", "ditch": "Zanja", "drain": "Desagüe a cielo abierto",
             "moat": "Foso", "fishpond": "Estanque de peces"}


def consulta_overpass():
    caja = f"{LAT_MIN},{LON_MIN},{LAT_MAX},{LON_MAX}"
    cursos = "|".join(CURSOS)
    return f"""[out:xml][timeout:180];
(
  way["natural"="water"]({caja});
  relation["natural"="water"]({caja});
  way["landuse"~"^(reservoir|basin)$"]({caja});
  relation["landuse"~"^(reservoir|basin)$"]({caja});
  way["waterway"="riverbank"]({caja});
  relation["waterway"="riverbank"]({caja});
  way["waterway"~"^({cursos})$"]({caja});
);
(._;>;);
out body;"""


# ---------------------------------------------------------------------------
# Atributos (sin QGIS: se pueden probar solos)
# ---------------------------------------------------------------------------
def etiquetas(other_tags):
    """'"water"=>"lake","intermittent"=>"yes"' -> {'water': 'lake', 'intermittent': 'yes'}"""
    salida = {}
    if not other_tags:
        return salida
    texto, i = str(other_tags), 0

    def cadena(i):
        # lee "..." desde texto[i] == '"', respetando \"
        j, partes = i + 1, []
        while j < len(texto):
            c = texto[j]
            if c == "\\" and j + 1 < len(texto):
                partes.append(texto[j + 1]); j += 2; continue
            if c == '"':
                return "".join(partes), j + 1
            partes.append(c); j += 1
        return "".join(partes), j

    while i < len(texto):
        if texto[i] != '"':
            i += 1
            continue
        clave, i = cadena(i)
        if texto[i:i + 2] != "=>":
            continue
        i += 2
        if i < len(texto) and texto[i] == '"':
            valor, i = cadena(i)
            salida[clave] = valor
    return salida


def atributos_poligono(nombre, natural, landuse, otras):
    et = etiquetas(otras)
    if natural == "water":
        tipo = TIPO_AGUA.get(et.get("water", ""), "Espejo de agua")
        capa = "OSM natural=water"
    elif landuse in ("reservoir", "basin"):
        tipo, capa = TIPO_AGUA[landuse], f"OSM landuse={landuse}"
    elif et.get("waterway") == "riverbank":
        tipo, capa = "Río", "OSM waterway=riverbank"
    else:
        return None
    return {"nombre": (nombre or et.get("name:es") or "").strip(), "tipo": tipo,
            "regimen": "intermitente" if et.get("intermittent") == "yes" else "",
            "capa": capa}


def atributos_linea(nombre, waterway, otras):
    if waterway not in CURSOS:
        return None
    et = etiquetas(otras)
    return {"nombre": (nombre or et.get("name:es") or "").strip(), "tipo": TIPO_LINEA[waterway],
            "regimen": "intermitente" if et.get("intermittent") == "yes" else "",
            "capa": f"OSM waterway={waterway}"}


# ---------------------------------------------------------------------------
# QGIS
# ---------------------------------------------------------------------------
def descargar():
    from qgis.core import QgsBlockingNetworkRequest
    from qgis.PyQt.QtCore import QByteArray, QUrl
    from qgis.PyQt.QtNetwork import QNetworkRequest

    cuerpo = QByteArray(("data=" + urllib.parse.quote(consulta_overpass())).encode("utf-8"))
    ultimo_error = ""
    for servidor in SERVIDORES:
        for intento in range(2):
            pedido = QNetworkRequest(QUrl(servidor))
            pedido.setHeader(QNetworkRequest.ContentTypeHeader, "application/x-www-form-urlencoded")
            pedido.setRawHeader(b"User-Agent", b"basurales-gran-resistencia (QGIS)")
            red = QgsBlockingNetworkRequest()
            print(f"Consultando {servidor} ...")
            error = red.post(pedido, cuerpo)
            datos = bytes(red.reply().content())
            if error == QgsBlockingNetworkRequest.NoError and datos.lstrip().startswith(b"<?xml") \
                    and b"<remark>" not in datos[:2000]:
                os.makedirs(CARPETA, exist_ok=True)
                with open(ARCHIVO_OSM, "wb") as f:
                    f.write(datos)
                print(f"Descargado: {len(datos) / 1e6:.1f} MB")
                return
            ultimo_error = red.errorMessage() or datos[:300].decode("utf-8", "replace")
            print("  No respondió bien:", ultimo_error[:200])
            time.sleep(10)
    raise RuntimeError("Overpass no respondió. Probá de nuevo en unos minutos. " + ultimo_error[:300])


def leer_osm():
    from qgis.core import QgsGeometry, QgsRectangle, QgsVectorLayer, QgsWkbTypes

    area = QgsGeometry.fromRect(QgsRectangle(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX))
    salida = []
    for capa_gdal, tipo_geom in (("multipolygons", QgsWkbTypes.PolygonGeometry),
                                 ("lines", QgsWkbTypes.LineGeometry)):
        capa = QgsVectorLayer(f"{ARCHIVO_OSM}|layername={capa_gdal}", capa_gdal, "ogr")
        if not capa.isValid():
            raise RuntimeError(f"GDAL no pudo leer la capa {capa_gdal} de {ARCHIVO_OSM}")
        campos = capa.fields().names()
        valor = lambda f, c: (f[c] if c in campos and f[c] not in (None, "") else None)
        for f in capa.getFeatures():
            if capa_gdal == "multipolygons":
                props = atributos_poligono(valor(f, "name"), valor(f, "natural"),
                                           valor(f, "landuse"), valor(f, "other_tags"))
            else:
                props = atributos_linea(valor(f, "name"), valor(f, "waterway"), valor(f, "other_tags"))
            if props is None:
                continue
            g = QgsGeometry(f.geometry())
            if g.isNull() or g.isEmpty():
                continue
            if tipo_geom == QgsWkbTypes.PolygonGeometry and not g.isGeosValid():
                g = g.makeValid()
            if not g.intersects(area):
                continue
            g = g.intersection(area)
            if g.type() != tipo_geom:
                g = g.convertToType(tipo_geom, True)
            if g is None or g.isNull() or g.isEmpty():
                continue
            if not g.isMultipart():
                g.convertToMultiType()
            salida.append((g, props))
    return salida


def leer_ign():
    from qgis.core import QgsGeometry
    if not os.path.exists(IGN):
        raise RuntimeError(f"Falta {IGN}: corré antes el script 04.")
    ign = []
    for f in json.load(open(IGN, encoding="utf-8"))["features"]:
        g = QgsGeometry.fromWkt(_wkt(f["geometry"]))
        ign.append((g, {k: f["properties"].get(k) or "" for k in ("nombre", "tipo", "regimen", "capa")}))
    return ign


def _wkt(geom):
    """GeoJSON -> WKT para (Multi)Polygon y (Multi)LineString."""
    anillo = lambda a: "(" + ", ".join(f"{x} {y}" for x, y, *_ in a) + ")"
    t, c = geom["type"], geom["coordinates"]
    if t == "Polygon":
        return "POLYGON(" + ", ".join(anillo(a) for a in c) + ")"
    if t == "MultiPolygon":
        return "MULTIPOLYGON(" + ", ".join("(" + ", ".join(anillo(a) for a in p) + ")" for p in c) + ")"
    if t == "LineString":
        return "LINESTRING" + anillo(c)
    if t == "MultiLineString":
        return "MULTILINESTRING(" + ", ".join(anillo(l) for l in c) + ")"
    raise ValueError(t)


def juntar(ign, osm):
    from qgis.core import QgsSpatialIndex, QgsFeature, QgsWkbTypes
    indice = QgsSpatialIndex()
    for i, (g, _) in enumerate(ign):
        f = QgsFeature(i); f.setGeometry(g); indice.addFeature(f)
    juntos, repetidos = list(ign), 0
    for g, props in osm:
        if g.type() == QgsWkbTypes.PolygonGeometry and g.area() > 0:
            dentro = 0.0
            for i in indice.intersects(g.boundingBox()):
                if ign[i][0].intersects(g):
                    dentro += ign[i][0].intersection(g).area()
            if dentro >= SOLAPE_REPETIDO * g.area():
                repetidos += 1
                continue
        juntos.append((g, props))
    return juntos, repetidos


def escribir(ruta, entidades, nombre):
    datos = {"type": "FeatureCollection", "name": nombre,
             "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
             "features": [{"type": "Feature", "properties": p, "geometry": json.loads(g.asJson(7))}
                          for g, p in entidades]}
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False)


def main():
    if DESCARGAR or not os.path.exists(ARCHIVO_OSM):
        descargar()
    osm = leer_osm()
    ign = leer_ign()
    juntos, repetidos = juntar(ign, osm)
    escribir(SALIDA_OSM, osm, "agua_osm_gran_resistencia")
    escribir(SALIDA, juntos, "agua_contexto_gran_resistencia")

    cuenta = {}
    for _, p in osm:
        cuenta[(p["capa"], p["tipo"])] = cuenta.get((p["capa"], p["tipo"]), 0) + 1
    print("\nOSM, por origen y tipo:")
    for (capa, tipo), n in sorted(cuenta.items(), key=lambda x: -x[1]):
        print(f"  {n:5d}  {tipo}  ({capa})")
    nombres = sorted({p["nombre"] for _, p in osm if p["nombre"]})
    print(f"\nCon nombre: {len(nombres)}. Algunos: " + ", ".join(nombres[:15]))
    print(f"\nIGN: {len(ign)}  +  OSM: {len(osm)}  -  repetidos con el IGN: {repetidos}"
          f"  =  {len(juntos)} entidades para capa_agua")
    print("Salidas:\n  " + SALIDA_OSM + "\n  " + SALIDA)
    for carpeta in COPIAS:
        os.makedirs(carpeta, exist_ok=True)
        for ruta in (SALIDA_OSM, SALIDA):
            shutil.copy2(ruta, carpeta)
        print("Copia en:", carpeta)

    from qgis.core import QgsProject, QgsVectorLayer
    for ruta in (SALIDA, SALIDA_OSM):
        capa = QgsVectorLayer(ruta, os.path.splitext(os.path.basename(ruta))[0], "ogr")
        if capa.isValid():
            QgsProject.instance().addMapLayer(capa)


if __name__ in ("__main__", "__console__") or "qgis" in sys.modules:
    try:
        import qgis.core  # noqa: F401
    except ImportError:
        print("Este script se corre en la consola de Python de QGIS.")
    else:
        main()
