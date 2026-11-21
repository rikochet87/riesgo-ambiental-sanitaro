# -*- coding: utf-8 -*-
"""
01_recorte_radios.py
====================
Recorta los radios censales 2022 (base de Gonzalo Rodriguez, CONICET 2024,
radios2022_v1.0) al área del Gran Resistencia.

Criterio: provincia 22 (Chaco) y polígono del radio que toca (intersección
real) el área de la app (lon -59.15 a -58.85, lat -27.62 a -27.30).
Es el mismo rectángulo de config.js y de la regla dentro_gran_resistencia
de la base. Entran radios rurales grandes que solo tocan el área en parte;
no afecta al índice porque la población se reparte según el área que cae
dentro de cada buffer.

Salidas (en datos/radios/):
  radios_gran_resistencia_2022.shp      (+ .shx .dbf .prj .cpg)
  radios_gran_resistencia_2022.geojson

Resultado esperado con radios2022_v1.0: 567 radios
  (San Fernando 529, Libertad 22, 1° de Mayo 16).

Además guarda una copia en cada carpeta de COPIAS
(se configuran en scripts/rutas_locales.py).

CÓMO CORRERLO
-------------
A) En QGIS: Complementos > Consola de Python > Mostrar editor >
   abrir este archivo > Ejecutar. Al terminar agrega la capa al mapa.
B) Fuera de QGIS (Python con pyshp: pip install pyshp):
   python 01_recorte_radios.py [ruta_origen.shp] [carpeta_salida]

Si los archivos están en otro lugar, cambiá ORIGEN y SALIDA abajo.
"""

import os
import sys
import json

# ---------------------------------------------------------------------------
# Rutas: relativas a la carpeta del proyecto. Las rutas propias de cada
# computadora (origen de datos, carpetas de copia) van en scripts/rutas_locales.py,
# que no se sube al repositorio (ver rutas_locales.ejemplo.py).
# ---------------------------------------------------------------------------
import inspect
import runpy


def _carpeta_de_este_script():
    # En la consola de QGIS el script se ejecuta con exec(compile(texto, ruta, "exec")):
    # la ruta queda en el código, aunque __file__ no exista.
    ruta = inspect.currentframe().f_code.co_filename
    if ruta.startswith("<"):
        try:
            ruta = __file__
        except NameError:
            raise RuntimeError("No pude saber dónde está el script: abrilo desde el editor de la "
                               "consola de QGIS o corrélo con python desde una terminal.")
    return os.path.dirname(os.path.abspath(ruta))


CARPETA_SCRIPTS = _carpeta_de_este_script()
PROYECTO = os.path.dirname(CARPETA_SCRIPTS)
_ARCHIVO_LOCAL = os.path.join(CARPETA_SCRIPTS, "rutas_locales.py")
LOCALES = runpy.run_path(_ARCHIVO_LOCAL) if os.path.exists(_ARCHIVO_LOCAL) else {}

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------
ORIGEN = LOCALES.get("ORIGEN_RADIOS",
                     os.path.join(PROYECTO, "fuentes", "RADIOS_2022_v1_0", "radios2022_v1.0.shp"))
SALIDA = os.path.join(PROYECTO, "datos", "radios")
NOMBRE = "radios_gran_resistencia_2022"
# Carpetas adicionales donde se guarda una copia de la salida (en rutas_locales.py)
COPIAS = LOCALES.get("COPIAS", [])

PROVINCIA = "22"                               # Chaco
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = -59.15, -27.62, -58.85, -27.30

# Permite pasar rutas por línea de comandos (fuera de QGIS)
if __name__ == "__main__" and len(sys.argv) >= 3 and sys.argv[1].lower().endswith(".shp"):
    ORIGEN, SALIDA = sys.argv[1], sys.argv[2]
    COPIAS = sys.argv[3:]


def resumen(conteo_deptos, total):
    print(f"Radios recortados: {total}")
    for depto, n in sorted(conteo_deptos.items(), key=lambda x: -x[1]):
        print(f"  {depto}: {n}")
    print(f"Salida: {SALIDA}")


def copiar_a_otras_rutas():
    """Copia todos los archivos de la salida (NOMBRE.*) a cada carpeta de COPIAS."""
    import glob
    import shutil
    archivos = glob.glob(os.path.join(SALIDA, NOMBRE + ".*"))
    for carpeta in COPIAS:
        os.makedirs(carpeta, exist_ok=True)
        for archivo in archivos:
            shutil.copy2(archivo, carpeta)
        print(f"Copia en: {carpeta}")


# ---------------------------------------------------------------------------
# A) Dentro de QGIS (PyQGIS)
# ---------------------------------------------------------------------------
def recortar_con_qgis():
    from qgis.core import (QgsVectorLayer, QgsFeatureRequest, QgsRectangle,
                           QgsVectorFileWriter, QgsCoordinateTransformContext,
                           QgsProject)

    capa = QgsVectorLayer(ORIGEN, "radios2022", "ogr")
    if not capa.isValid():
        raise RuntimeError(f"No se pudo abrir {ORIGEN}")
    capa.setProviderEncoding("UTF-8")

    pedido = (QgsFeatureRequest()
              .setFilterRect(QgsRectangle(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX))
              .setFilterExpression(f"\"PROV\" = '{PROVINCIA}'"))
    ids = [f.id() for f in capa.getFeatures(pedido)]
    capa.selectByIds(ids)

    conteo = {}
    for f in capa.getSelectedFeatures():
        conteo[f["NOMDEPTO"]] = conteo.get(f["NOMDEPTO"], 0) + 1

    os.makedirs(SALIDA, exist_ok=True)
    ctx = QgsCoordinateTransformContext()
    for driver, ext in (("ESRI Shapefile", "shp"), ("GeoJSON", "geojson")):
        opciones = QgsVectorFileWriter.SaveVectorOptions()
        opciones.driverName = driver
        opciones.fileEncoding = "UTF-8"
        opciones.onlySelectedFeatures = True
        destino = os.path.join(SALIDA, f"{NOMBRE}.{ext}")
        error = QgsVectorFileWriter.writeAsVectorFormatV3(capa, destino, ctx, opciones)
        if error[0] != QgsVectorFileWriter.NoError:
            raise RuntimeError(f"Error al guardar {destino}: {error}")

    capa.removeSelection()
    resumen(conteo, len(ids))
    copiar_a_otras_rutas()

    # Agrega el resultado al proyecto abierto
    resultado = QgsVectorLayer(os.path.join(SALIDA, f"{NOMBRE}.shp"), NOMBRE, "ogr")
    if resultado.isValid():
        QgsProject.instance().addMapLayer(resultado)


# ---------------------------------------------------------------------------
# B) Fuera de QGIS (pyshp)
# ---------------------------------------------------------------------------
def _segmentos_se_cruzan(p1, p2, q1, q2):
    def orient(a, b, c):
        v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        return (v > 0) - (v < 0)
    def sobre(a, b, c):
        return min(a[0], b[0]) <= c[0] <= max(a[0], b[0]) and min(a[1], b[1]) <= c[1] <= max(a[1], b[1])
    o1, o2, o3, o4 = orient(p1, p2, q1), orient(p1, p2, q2), orient(q1, q2, p1), orient(q1, q2, p2)
    if o1 != o2 and o3 != o4:
        return True
    return ((o1 == 0 and sobre(p1, p2, q1)) or (o2 == 0 and sobre(p1, p2, q2)) or
            (o3 == 0 and sobre(q1, q2, p1)) or (o4 == 0 and sobre(q1, q2, p2)))


def _punto_en_anillos(x, y, anillos):
    dentro = False  # regla par-impar: respeta los huecos
    for anillo in anillos:
        for (x1, y1), (x2, y2) in zip(anillo, anillo[1:]):
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                dentro = not dentro
    return dentro


def _toca_area(shp):
    """Intersección real entre el polígono y el rectángulo del área."""
    x0, y0, x1, y1 = shp.bbox
    if x1 < LON_MIN or x0 > LON_MAX or y1 < LAT_MIN or y0 > LAT_MAX:
        return False
    partes = list(shp.parts) + [len(shp.points)]
    anillos = [shp.points[partes[k]:partes[k + 1]] for k in range(len(partes) - 1)]
    # 1) algún vértice dentro del rectángulo
    for anillo in anillos:
        for x, y in anillo:
            if LON_MIN <= x <= LON_MAX and LAT_MIN <= y <= LAT_MAX:
                return True
    # 2) alguna esquina del rectángulo dentro del polígono
    esquinas = [(LON_MIN, LAT_MIN), (LON_MAX, LAT_MIN), (LON_MAX, LAT_MAX), (LON_MIN, LAT_MAX)]
    if any(_punto_en_anillos(x, y, anillos) for x, y in esquinas):
        return True
    # 3) algún borde del polígono cruza un borde del rectángulo
    bordes = list(zip(esquinas, esquinas[1:] + esquinas[:1]))
    for anillo in anillos:
        for a, b in zip(anillo, anillo[1:]):
            if any(_segmentos_se_cruzan(a, b, c, d) for c, d in bordes):
                return True
    return False


def recortar_con_pyshp():
    import shapefile  # pip install pyshp

    base = ORIGEN[:-4]  # sin ".shp" (el nombre tiene ".0", por eso se abre cada archivo)
    src = shapefile.Reader(shp=open(base + ".shp", "rb"), shx=open(base + ".shx", "rb"),
                           dbf=open(base + ".dbf", "rb"), encoding="utf-8")

    os.makedirs(SALIDA, exist_ok=True)
    destino = os.path.join(SALIDA, NOMBRE)
    w = shapefile.Writer(destino, shapeType=src.shapeType, encoding="utf-8")
    for campo in src.fields[1:]:
        w.field(*campo)

    entidades, conteo = [], {}
    for i in range(len(src)):
        rec = src.record(i)
        if rec["PROV"] != PROVINCIA:
            continue
        shp = src.shape(i)
        if not _toca_area(shp):
            continue
        w.record(*rec)
        w.shape(shp)
        conteo[rec["NOMDEPTO"]] = conteo.get(rec["NOMDEPTO"], 0) + 1
        entidades.append({"type": "Feature", "properties": rec.as_dict(),
                          "geometry": shp.__geo_interface__})
    w.close()

    with open(base + ".prj", encoding="utf-8") as f:
        prj = f.read()
    with open(destino + ".prj", "w", encoding="utf-8") as f:
        f.write(prj)
    with open(destino + ".cpg", "w", encoding="utf-8") as f:
        f.write("UTF-8")
    with open(destino + ".geojson", "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": entidades}, f, ensure_ascii=False)

    resumen(conteo, len(entidades))
    copiar_a_otras_rutas()


# ---------------------------------------------------------------------------
def dentro_de_qgis():
    try:
        from qgis.core import QgsApplication
        return QgsApplication.instance() is not None
    except ImportError:
        return False


if dentro_de_qgis():
    recortar_con_qgis()
else:
    recortar_con_pyshp()
