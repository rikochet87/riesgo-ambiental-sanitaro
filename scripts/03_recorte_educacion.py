# -*- coding: utf-8 -*-
"""
03_recorte_educacion.py
=======================
Recorta los puntos de ciencia y educación del IGN (capa
"Puntos_de_Ciencia_y_Educacion_Chaco") al área del Gran Resistencia: el mismo rectángulo que
01_recorte_radios.py, config.js y la regla dentro_gran_resistencia de la base
(lon -59.15 a -58.85, lat -27.62 a -27.30).

Además agrega el campo "nombre" (el que usa la tabla capa_escuelas de la base),
copiado del campo de nombre que traiga la capa (en el IGN suele ser "fna"
o "nam"). Si no encuentra ninguno, lo deja vacío y avisa.

Al terminar muestra cuántos puntos hay de cada tipo (campo "gna" u
"objeto" del IGN), para decidir si conviene excluir alguno (por ejemplo
institutos de investigación) antes de cargarlo en capa_escuelas. Para
excluir tipos, completá TIPOS_EXCLUIR y volvé a correrlo.

Salidas (en datos/educacion/):
  educacion_gran_resistencia.shp   (+ .shx .dbf .prj .cpg)
  educacion_gran_resistencia.geojson

Además guarda una copia en cada carpeta de COPIAS
(se configuran en scripts/rutas_locales.py).

CÓMO CORRERLO
-------------
A) En QGIS (recomendado): con la capa "Puntos_de_Ciencia_y_Educacion_Chaco" cargada en el
   proyecto, Complementos > Consola de Python > Mostrar editor > abrir este
   archivo > Ejecutar. Si la capa tiene otro sistema de coordenadas, el área
   se transforma sola. Al terminar agrega el resultado al mapa.
B) Fuera de QGIS (pyshp, solo si la capa está en EPSG:4326):
   python 03_recorte_educacion.py ruta_de_la_capa.shp [carpeta_salida]
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
CAPA = "Puntos_de_Ciencia_y_Educacion_Chaco"   # nombre en el panel de capas, o ruta a un .shp
SALIDA = os.path.join(PROYECTO, "datos", "educacion")
NOMBRE = "educacion_gran_resistencia"
# Carpetas adicionales donde se guarda una copia de la salida (en rutas_locales.py)
COPIAS = LOCALES.get("COPIAS", [])

LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = -59.15, -27.62, -58.85, -27.30
CAMPOS_NOMBRE = ["nombre", "fna", "nam", "NOMBRE", "FNA", "NAM", "name", "Name"]
CAMPOS_TIPO = ["gna", "GNA", "objeto", "OBJETO", "tipo", "TIPO"]
TIPOS_EXCLUIR = []   # ej.: ["Instituto de investigación"] (texto exacto del tipo)

if __name__ == "__main__" and len(sys.argv) >= 2 and sys.argv[1].lower().endswith(".shp"):
    CAPA = sys.argv[1]
    if len(sys.argv) >= 3:
        SALIDA = sys.argv[2]
    COPIAS = sys.argv[3:]


def resumen(total, campo_nombre, ejemplos, conteo_tipos=None, campo_tipo=None, excluidos=0):
    print(f"Puntos de ciencia y educación recortados: {total}")
    if excluidos:
        print(f"Excluidos por TIPOS_EXCLUIR: {excluidos}")
    if conteo_tipos:
        print(f"Por tipo (campo '{campo_tipo}'):")
        for t, n in sorted(conteo_tipos.items(), key=lambda x: -x[1]):
            print(f"  {n:4d}  {t}")
    print(f"Campo usado para 'nombre': {campo_nombre or 'NINGUNO (revisar)'}")
    for e in ejemplos[:5]:
        print(f"  - {e}")
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
    from qgis.core import (QgsProject, QgsVectorLayer, QgsFeatureRequest, QgsRectangle,
                           QgsCoordinateReferenceSystem, QgsCoordinateTransform,
                           QgsVectorFileWriter, QgsField, QgsFeature, QgsFields,
                           QgsWkbTypes, QgsMemoryProviderUtils)
    from qgis.core import Qgis
    if Qgis.versionInt() >= 33800:          # QGIS 3.38+ usa QMetaType
        from qgis.PyQt.QtCore import QMetaType
        TIPO_TEXTO = QMetaType.Type.QString
    else:
        from qgis.PyQt.QtCore import QVariant
        TIPO_TEXTO = QVariant.String

    # Buscar la capa por nombre en el proyecto o abrirla desde un archivo
    if os.path.isfile(CAPA):
        capa = QgsVectorLayer(CAPA, "educacion", "ogr")
    else:
        encontradas = QgsProject.instance().mapLayersByName(CAPA)
        if not encontradas:
            raise RuntimeError(f"No encontré la capa '{CAPA}' en el proyecto. "
                               "Cargala o poné su ruta en CAPA.")
        capa = encontradas[0]
    if not capa.isValid():
        raise RuntimeError("La capa no es válida.")

    # Área en el sistema de coordenadas de la capa
    wgs84 = QgsCoordinateReferenceSystem("EPSG:4326")
    area = QgsRectangle(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)
    a_wgs84 = None
    if capa.crs() != wgs84:
        area = QgsCoordinateTransform(wgs84, capa.crs(), QgsProject.instance()).transformBoundingBox(area)
        a_wgs84 = QgsCoordinateTransform(capa.crs(), wgs84, QgsProject.instance())
        print(f"La capa está en {capa.crs().authid()}: área transformada.")

    nombres_campos = [f.name() for f in capa.fields()]
    campo_nombre = next((c for c in CAMPOS_NOMBRE if c in nombres_campos), None)
    campo_tipo = next((c for c in CAMPOS_TIPO if c in nombres_campos), None)
    conteo_tipos, excluidos = {}, 0

    # Capa temporal con los campos originales + "nombre"
    campos = QgsFields(capa.fields())
    if "nombre" not in nombres_campos:
        campos.append(QgsField("nombre", TIPO_TEXTO))
    tmp = QgsMemoryProviderUtils.createMemoryLayer(NOMBRE, campos, capa.wkbType(), capa.crs())
    pedido = QgsFeatureRequest().setFilterRect(area).setFlags(QgsFeatureRequest.ExactIntersect)
    nuevas, ejemplos = [], []
    for f in capa.getFeatures(pedido):
        # Control final en WGS84 (el área transformada puede quedar algo más grande)
        p = f.geometry().centroid().asPoint()
        if a_wgs84 is not None:
            p = a_wgs84.transform(p)
        if not (LON_MIN <= p.x() <= LON_MAX and LAT_MIN <= p.y() <= LAT_MAX):
            continue
        tipo = str(f[campo_tipo]) if campo_tipo else "(sin campo de tipo)"
        if tipo in TIPOS_EXCLUIR:
            excluidos += 1
            continue
        conteo_tipos[tipo] = conteo_tipos.get(tipo, 0) + 1
        g = QgsFeature(campos)
        g.setGeometry(f.geometry())
        atributos = f.attributes()
        if "nombre" not in nombres_campos:
            valor = f[campo_nombre] if campo_nombre else None
            atributos = atributos + [valor]
        g.setAttributes(atributos)
        nuevas.append(g)
        if campo_nombre:
            ejemplos.append(str(f[campo_nombre]))
    tmp.dataProvider().addFeatures(nuevas)

    os.makedirs(SALIDA, exist_ok=True)
    for driver, ext in (("ESRI Shapefile", "shp"), ("GeoJSON", "geojson")):
        opciones = QgsVectorFileWriter.SaveVectorOptions()
        opciones.driverName = driver
        opciones.fileEncoding = "UTF-8"
        # La base espera EPSG:4326
        if capa.crs() != wgs84:
            opciones.ct = QgsCoordinateTransform(capa.crs(), wgs84, QgsProject.instance())
        destino = os.path.join(SALIDA, f"{NOMBRE}.{ext}")
        error = QgsVectorFileWriter.writeAsVectorFormatV3(
            tmp, destino, QgsProject.instance().transformContext(), opciones)
        if error[0] != QgsVectorFileWriter.NoError:
            raise RuntimeError(f"Error al guardar {destino}: {error}")

    resumen(len(nuevas), campo_nombre, ejemplos, conteo_tipos, campo_tipo, excluidos)
    copiar_a_otras_rutas()
    resultado = QgsVectorLayer(os.path.join(SALIDA, f"{NOMBRE}.shp"), NOMBRE, "ogr")
    if resultado.isValid():
        QgsProject.instance().addMapLayer(resultado)


# ---------------------------------------------------------------------------
# B) Fuera de QGIS (pyshp). Solo puntos en EPSG:4326.
# ---------------------------------------------------------------------------
def recortar_con_pyshp():
    import shapefile  # pip install pyshp

    if not CAPA.lower().endswith(".shp"):
        raise RuntimeError("Fuera de QGIS hay que pasar la ruta al .shp")
    base = CAPA[:-4]
    prj = open(base + ".prj", encoding="utf-8").read() if os.path.exists(base + ".prj") else ""
    if prj and "WGS" not in prj.upper() and "4326" not in prj:
        raise RuntimeError("La capa no está en WGS84: corré el script en QGIS.")

    src = shapefile.Reader(shp=open(base + ".shp", "rb"), shx=open(base + ".shx", "rb"),
                           dbf=open(base + ".dbf", "rb"), encoding="utf-8")
    nombres_campos = [c[0] for c in src.fields[1:]]
    campo_nombre = next((c for c in CAMPOS_NOMBRE if c in nombres_campos), None)
    campo_tipo = next((c for c in CAMPOS_TIPO if c in nombres_campos), None)
    conteo_tipos, excluidos = {}, 0

    os.makedirs(SALIDA, exist_ok=True)
    destino = os.path.join(SALIDA, NOMBRE)
    w = shapefile.Writer(destino, shapeType=src.shapeType, encoding="utf-8")
    for campo in src.fields[1:]:
        w.field(*campo)
    if "nombre" not in nombres_campos:
        w.field("nombre", "C", 254)

    entidades, ejemplos = [], []
    for i in range(len(src)):
        shp = src.shape(i)
        if not shp.points:
            continue
        x, y = shp.points[0]
        if not (LON_MIN <= x <= LON_MAX and LAT_MIN <= y <= LAT_MAX):
            continue
        rec = src.record(i)
        tipo = str(rec[campo_tipo]) if campo_tipo else "(sin campo de tipo)"
        if tipo in TIPOS_EXCLUIR:
            excluidos += 1
            continue
        conteo_tipos[tipo] = conteo_tipos.get(tipo, 0) + 1
        valores = list(rec)
        props = rec.as_dict()
        if "nombre" not in nombres_campos:
            valor = rec[campo_nombre] if campo_nombre else ""
            valores.append(valor)
            props["nombre"] = valor
        w.record(*valores)
        w.shape(shp)
        entidades.append({"type": "Feature", "properties": props, "geometry": shp.__geo_interface__})
        if campo_nombre:
            ejemplos.append(str(rec[campo_nombre]))
    w.close()

    if prj:
        open(destino + ".prj", "w", encoding="utf-8").write(prj)
    open(destino + ".cpg", "w", encoding="utf-8").write("UTF-8")
    with open(destino + ".geojson", "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": entidades}, f,
                  ensure_ascii=False, default=str)

    resumen(len(entidades), campo_nombre, ejemplos, conteo_tipos, campo_tipo, excluidos)
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
