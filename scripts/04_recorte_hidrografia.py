# -*- coding: utf-8 -*-
"""
04_recorte_hidrografia.py
=========================
Recorta la hidrografía del IGN (capas "areas_de_aguas_continentales_*" y
"lineas_de_aguas_continentales_*") al área del Gran Resistencia, cortando la
geometría al rectángulo de la app (lon -59.15 a -58.85, lat -27.62 a -27.30),
el mismo de los recortes anteriores, config.js y la base.

Une todas las capas en una sola capa de agua para la tabla capa_agua, con:
  nombre   nombre del curso o cuerpo de agua (campo "fna" o "nam" del IGN)
  tipo     término genérico del IGN (campo "gna": laguna, río, canal...);
           si viene vacío, la descripción del IGN (campo "objeto"), y si
           tampoco está, el nombre de la capa
  regimen  perenne / intermitente (según el nombre de la capa)
  capa     capa de origen

Si la misma capa está cargada varias veces en el proyecto, se toma una sola vez.
Para dejar afuera alguna capa, agregá su nombre (como figura en el panel de
capas) a EXCLUIR_CAPAS. Para sumar los puntos (manantiales, etc.), agregá
"puntos_de_aguas_continentales" a PREFIJOS.

Salidas (en datos/hidrografia/ y copia en COPIAS):
  agua_areas_gran_resistencia.shp / .geojson    (lagunas, ríos como polígono)
  agua_lineas_gran_resistencia.shp / .geojson   (ríos, arroyos, canales)
  agua_gran_resistencia.geojson                 (todo junto, para capa_agua)

CÓMO CORRERLO
-------------
A) En QGIS (recomendado): con las capas cargadas en el proyecto,
   Complementos > Consola de Python > Mostrar editor > abrir este archivo >
   Ejecutar. Reproyecta solo si alguna capa no está en EPSG:4326.
B) Fuera de QGIS (requiere: pip install pyshp shapely; capas en EPSG:4326):
   python 04_recorte_hidrografia.py carpeta_con_los_shp carpeta_salida [copia ...]
"""

import os
import sys
import json
import glob
import shutil

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
PREFIJOS = ["areas_de_aguas_continentales", "lineas_de_aguas_continentales"]
EXCLUIR_CAPAS = []      # nombres exactos de capas a dejar afuera
CARPETA_SHP = None      # solo fuera de QGIS: carpeta con los .shp del IGN

SALIDA = os.path.join(PROYECTO, "datos", "hidrografia")
NOMBRE = "agua_gran_resistencia"
# Carpetas adicionales donde se guarda una copia de la salida (en rutas_locales.py)
COPIAS = LOCALES.get("COPIAS", [])

LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = -59.15, -27.62, -58.85, -27.30
CAMPOS_NOMBRE = ["fna", "nam", "nombre", "FNA", "NAM", "NOMBRE", "name"]
CAMPOS_TIPO = ["gna", "GNA", "tipo", "TIPO"]
CAMPOS_OBJETO = ["objeto", "OBJETO"]   # descripción del IGN, si falta el tipo

if __name__ == "__main__" and len(sys.argv) >= 3 and os.path.isdir(sys.argv[1]):
    CARPETA_SHP, SALIDA = sys.argv[1], sys.argv[2]
    COPIAS = sys.argv[3:]


def regimen_de(nombre_capa):
    n = nombre_capa.lower()
    if "perenne" in n:
        return "perenne"
    if "intermit" in n:
        return "intermitente"
    return ""


def texto(valor):
    if valor is None:
        return ""
    s = str(valor).strip()
    return "" if s.upper() in ("NULL", "NONE") else s


def unir_geojson(archivos):
    """Une los GeoJSON de áreas, líneas y puntos en NOMBRE.geojson."""
    entidades = []
    for a in archivos:
        if os.path.exists(a):
            with open(a, encoding="utf-8") as f:
                entidades += json.load(f)["features"]
    with open(os.path.join(SALIDA, NOMBRE + ".geojson"), "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "name": NOMBRE,
                   "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
                   "features": entidades}, f, ensure_ascii=False)
    return len(entidades)


def copiar_a_otras_rutas():
    """Copia las salidas (agua_*gran_resistencia.*) a cada carpeta de COPIAS."""
    archivos = glob.glob(os.path.join(SALIDA, "agua_*gran_resistencia.*"))
    for carpeta in COPIAS:
        os.makedirs(carpeta, exist_ok=True)
        for archivo in archivos:
            shutil.copy2(archivo, carpeta)
        print(f"Copia en: {carpeta}")


def resumen(por_capa, por_tipo, totales, total_unido):
    print("Entidades recortadas por capa de origen:")
    for c, n in sorted(por_capa.items()):
        print(f"  {n:5d}  {c}")
    print("Por tipo:")
    for t, n in sorted(por_tipo.items(), key=lambda x: -x[1]):
        print(f"  {n:5d}  {t or '(sin tipo)'}")
    for k, n in totales.items():
        print(f"{k}: {n}")
    print(f"Capa unida para la base: {total_unido} entidades")
    print(f"Salida: {SALIDA}")


# ---------------------------------------------------------------------------
# A) Dentro de QGIS (PyQGIS)
# ---------------------------------------------------------------------------
def recortar_con_qgis():
    from qgis.core import (Qgis, QgsProject, QgsVectorLayer, QgsFeatureRequest, QgsRectangle,
                           QgsGeometry, QgsCoordinateReferenceSystem, QgsCoordinateTransform,
                           QgsVectorFileWriter, QgsFeature, QgsWkbTypes)

    proyecto = QgsProject.instance()
    wgs84 = QgsCoordinateReferenceSystem("EPSG:4326")
    area = QgsRectangle(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)
    area_geom = QgsGeometry.fromRect(area)

    def con_acentos_correctos(capa):
        """Si la capa muestra acentos rotos (archivo en Windows-1252 leído como
        UTF-8), devuelve una copia leída en Windows-1252. No toca la capa original."""
        if capa.providerType() != "ogr":
            return capa
        campos = [f.name() for f in capa.fields()]
        campo = next((c for c in CAMPOS_NOMBRE + CAMPOS_TIPO if c in campos), None)
        if not campo:
            return capa
        muestra = capa.getFeatures(QgsFeatureRequest().setLimit(2000))
        if not any("�" in texto(f[campo]) for f in muestra):
            return capa
        copia = QgsVectorLayer(capa.source(), capa.name(), "ogr")
        copia.setProviderEncoding("windows-1252")
        print(f"{capa.name()}: acentos mal leídos, se relee en Windows-1252.")
        return copia

    # Capas a procesar (sin repetir la misma fuente)
    capas, fuentes = [], set()
    for capa in proyecto.mapLayers().values():
        if not isinstance(capa, QgsVectorLayer) or not capa.isValid():
            continue
        if not any(capa.name().startswith(p) for p in PREFIJOS) or capa.name() in EXCLUIR_CAPAS:
            continue
        if capa.source() in fuentes:
            continue
        fuentes.add(capa.source())
        capas.append(con_acentos_correctos(capa))
    if not capas:
        raise RuntimeError("No encontré capas que empiecen con: " + ", ".join(PREFIJOS))
    vistas = set()      # geometrías ya agregadas (evita duplicados entre capas)
    repetidas = 0

    # Capas de salida en memoria: 0 = puntos, 1 = líneas, 2 = polígonos
    definicion = "field=nombre:string(254)&field=tipo:string(100)&field=regimen:string(20)&field=capa:string(150)"
    salidas = {
        2: ("agua_areas_gran_resistencia", QgsVectorLayer("MultiPolygon?crs=EPSG:4326&" + definicion, "areas", "memory")),
        1: ("agua_lineas_gran_resistencia", QgsVectorLayer("MultiLineString?crs=EPSG:4326&" + definicion, "lineas", "memory")),
        0: ("agua_puntos_gran_resistencia", QgsVectorLayer("MultiPoint?crs=EPSG:4326&" + definicion, "puntos", "memory")),
    }
    nuevas = {0: [], 1: [], 2: []}
    por_capa, por_tipo = {}, {}

    for capa in capas:
        tipo_geom = int(capa.geometryType())     # 0 puntos, 1 líneas, 2 polígonos
        if tipo_geom not in salidas:
            continue
        a_wgs84 = None
        area_capa = area
        if capa.crs() != wgs84:
            a_wgs84 = QgsCoordinateTransform(capa.crs(), wgs84, proyecto)
            area_capa = QgsCoordinateTransform(wgs84, capa.crs(), proyecto).transformBoundingBox(area)
        campos = [f.name() for f in capa.fields()]
        campo_nombre = next((c for c in CAMPOS_NOMBRE if c in campos), None)
        campo_tipo = next((c for c in CAMPOS_TIPO if c in campos), None)
        campo_objeto = next((c for c in CAMPOS_OBJETO if c in campos), None)
        regimen = regimen_de(capa.name())

        for f in capa.getFeatures(QgsFeatureRequest().setFilterRect(area_capa)):
            g = QgsGeometry(f.geometry())
            if g.isNull() or g.isEmpty():
                continue
            if a_wgs84 is not None:
                g.transform(a_wgs84)
            if not g.intersects(area_geom):
                continue
            g = g.intersection(area_geom)
            # La intersección puede devolver una colección: se convierte al tipo de la capa
            if int(g.type()) != tipo_geom or g.isEmpty():
                g = g.convertToType(capa.geometryType(), True)
                if g is None or g.isNull() or g.isEmpty():
                    continue
            if not g.isMultipart():
                g.convertToMultiType()
            clave_geom = (tipo_geom, g.asWkt(7))
            if clave_geom in vistas:        # misma geometría ya cargada desde otra capa
                repetidas += 1
                continue
            vistas.add(clave_geom)
            tipo = ((texto(f[campo_tipo]) if campo_tipo else "")
                    or (texto(f[campo_objeto]) if campo_objeto else "") or capa.name())
            nueva = QgsFeature(salidas[tipo_geom][1].fields())
            nueva.setGeometry(g)
            nueva.setAttributes([texto(f[campo_nombre]) if campo_nombre else "", tipo, regimen, capa.name()])
            nuevas[tipo_geom].append(nueva)
            por_capa[capa.name()] = por_capa.get(capa.name(), 0) + 1
            por_tipo[tipo] = por_tipo.get(tipo, 0) + 1

    os.makedirs(SALIDA, exist_ok=True)
    geojsons, totales = [], {}
    for clave, (nombre, capa_mem) in salidas.items():
        if not nuevas[clave]:
            continue
        capa_mem.dataProvider().addFeatures(nuevas[clave])
        for driver, ext in (("ESRI Shapefile", "shp"), ("GeoJSON", "geojson")):
            opciones = QgsVectorFileWriter.SaveVectorOptions()
            opciones.driverName = driver
            opciones.fileEncoding = "UTF-8"
            destino = os.path.join(SALIDA, f"{nombre}.{ext}")
            error = QgsVectorFileWriter.writeAsVectorFormatV3(
                capa_mem, destino, proyecto.transformContext(), opciones)
            if error[0] != QgsVectorFileWriter.NoError:
                raise RuntimeError(f"Error al guardar {destino}: {error}")
        geojsons.append(os.path.join(SALIDA, f"{nombre}.geojson"))
        totales[nombre] = len(nuevas[clave])

    total_unido = unir_geojson(geojsons)
    resumen(por_capa, por_tipo, totales, total_unido)
    if repetidas:
        print(f"Descartadas por repetidas (misma geometría en otra capa): {repetidas}")
    copiar_a_otras_rutas()

    for nombre in totales:
        resultado = QgsVectorLayer(os.path.join(SALIDA, f"{nombre}.shp"), nombre, "ogr")
        if resultado.isValid():
            proyecto.addMapLayer(resultado)


# ---------------------------------------------------------------------------
# B) Fuera de QGIS (pyshp + shapely). Capas en EPSG:4326.
# ---------------------------------------------------------------------------
def recortar_con_python():
    import shapefile                      # pip install pyshp
    from shapely.geometry import shape, box, mapping
    from shapely.geometry import MultiPolygon, MultiLineString, MultiPoint

    if not CARPETA_SHP:
        raise RuntimeError("Fuera de QGIS: python 04_recorte_hidrografia.py carpeta_shp carpeta_salida")
    area = box(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)
    archivos = sorted(p for p in glob.glob(os.path.join(CARPETA_SHP, "*.shp"))
                      if any(os.path.basename(p).startswith(x) for x in PREFIJOS)
                      and os.path.splitext(os.path.basename(p))[0] not in EXCLUIR_CAPAS)
    if not archivos:
        raise RuntimeError("No encontré .shp que empiecen con: " + ", ".join(PREFIJOS))

    multis = {"Polygon": ("agua_areas_gran_resistencia", MultiPolygon, shapefile.POLYGON),
              "LineString": ("agua_lineas_gran_resistencia", MultiLineString, shapefile.POLYLINE),
              "Point": ("agua_puntos_gran_resistencia", MultiPoint, shapefile.MULTIPOINT)}
    nuevas = {k: [] for k in multis}
    por_capa, por_tipo = {}, {}
    vistas, repetidas = set(), 0

    for ruta in archivos:
        base = ruta[:-4]
        nombre_capa = os.path.basename(base)
        prj = base + ".prj"
        if os.path.exists(prj):
            contenido = open(prj, encoding="utf-8", errors="ignore").read().upper()
            if "WGS" not in contenido and "4326" not in contenido:
                raise RuntimeError(f"{nombre_capa} no está en WGS84: corré el script en QGIS.")
        # Codificación: UTF-8 si se puede leer así; si no, Windows-1252 (habitual en el IGN)
        codificacion = "utf-8"
        try:
            prueba = shapefile.Reader(dbf=open(base + ".dbf", "rb"), encoding="utf-8")
            for _ in prueba.iterRecords():
                pass
        except Exception as e:      # pyshp avisa con su propia excepción de decodificación
            if "decode" not in str(e).lower():
                raise
            codificacion = "cp1252"
            print(f"{nombre_capa}: se lee en Windows-1252.")
        src = shapefile.Reader(shp=open(base + ".shp", "rb"), shx=open(base + ".shx", "rb"),
                               dbf=open(base + ".dbf", "rb"), encoding=codificacion)
        campos = [c[0] for c in src.fields[1:]]
        campo_nombre = next((c for c in CAMPOS_NOMBRE if c in campos), None)
        campo_tipo = next((c for c in CAMPOS_TIPO if c in campos), None)
        campo_objeto = next((c for c in CAMPOS_OBJETO if c in campos), None)
        regimen = regimen_de(nombre_capa)
        for i in range(len(src)):
            shp = src.shape(i)
            if not shp.points:
                continue
            x0, y0, x1, y1 = shp.bbox if len(shp.points) > 1 else (*shp.points[0], *shp.points[0])
            if x1 < LON_MIN or x0 > LON_MAX or y1 < LAT_MIN or y0 > LAT_MAX:
                continue
            g = shape(shp.__geo_interface__)
            if not g.is_valid:
                g = g.buffer(0) if g.geom_type.endswith("Polygon") else g
            if not g.intersects(area):
                continue
            g = g.intersection(area)
            base_tipo = g.geom_type.replace("Multi", "")
            if base_tipo == "GeometryCollection" or base_tipo not in multis:
                partes = [p for p in getattr(g, "geoms", []) if p.geom_type.replace("Multi", "") in multis]
                if not partes:
                    continue
                base_tipo = partes[0].geom_type.replace("Multi", "")
                partes = [q for p in partes for q in getattr(p, "geoms", [p])
                          if q.geom_type == base_tipo]
                g = multis[base_tipo][1](partes)
            elif not g.geom_type.startswith("Multi"):
                g = multis[base_tipo][1]([g])
            if g.is_empty:
                continue
            clave_geom = (base_tipo, g.wkb_hex)
            if clave_geom in vistas:        # misma geometría ya cargada desde otra capa
                repetidas += 1
                continue
            vistas.add(clave_geom)
            rec = src.record(i)
            tipo = ((texto(rec[campo_tipo]) if campo_tipo else "")
                    or (texto(rec[campo_objeto]) if campo_objeto else "") or nombre_capa)
            props = {"nombre": texto(rec[campo_nombre]) if campo_nombre else "",
                     "tipo": tipo, "regimen": regimen, "capa": nombre_capa}
            nuevas[base_tipo].append((g, props))
            por_capa[nombre_capa] = por_capa.get(nombre_capa, 0) + 1
            por_tipo[tipo] = por_tipo.get(tipo, 0) + 1

    os.makedirs(SALIDA, exist_ok=True)
    prj_wgs84 = ('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],'
                 'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]')
    geojsons, totales = [], {}
    for clave, (nombre, _, tipo_shp) in multis.items():
        if not nuevas[clave]:
            continue
        destino = os.path.join(SALIDA, nombre)
        w = shapefile.Writer(destino, shapeType=tipo_shp, encoding="utf-8")
        w.field("nombre", "C", 254); w.field("tipo", "C", 100)
        w.field("regimen", "C", 20); w.field("capa", "C", 150)
        entidades = []
        for g, props in nuevas[clave]:
            w.shape(mapping(g))
            w.record(props["nombre"], props["tipo"], props["regimen"], props["capa"])
            entidades.append({"type": "Feature", "properties": props, "geometry": mapping(g)})
        w.close()
        open(destino + ".prj", "w", encoding="utf-8").write(prj_wgs84)
        open(destino + ".cpg", "w", encoding="utf-8").write("UTF-8")
        with open(destino + ".geojson", "w", encoding="utf-8") as f:
            json.dump({"type": "FeatureCollection", "features": entidades}, f, ensure_ascii=False)
        geojsons.append(destino + ".geojson")
        totales[nombre] = len(entidades)

    total_unido = unir_geojson(geojsons)
    resumen(por_capa, por_tipo, totales, total_unido)
    if repetidas:
        print(f"Descartadas por repetidas (misma geometría en otra capa): {repetidas}")
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
    recortar_con_python()
