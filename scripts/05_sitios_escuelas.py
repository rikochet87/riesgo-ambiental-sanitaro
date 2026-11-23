# -*- coding: utf-8 -*-
"""
05_sitios_escuelas.py
=====================
Junta en un solo "sitio" las escuelas que están a menos de DISTANCIA_M metros
entre sí, para que el índice de riesgo no cuente dos veces un mismo edificio.

Por qué: el Mapa Educativo (IGN) carga un punto por servicio educativo, no por
edificio. Una primaria de adultos que funciona de noche en una escuela de día
aparece como otro punto, a pocos metros. Decisión del 2026-11-23: agrupar a
50 m sin descartar ningún nivel.

Cómo agrupa: dos escuelas a menos de DISTANCIA_M quedan en el mismo sitio, y
también las que quedan unidas en cadena (A cerca de B, B cerca de C). Para
que una cadena larga no junte media manzana, un grupo cuyo diámetro supere
DIAMETRO_MAX_M se vuelve a partir con una distancia más corta. El sitio se
ubica en el promedio de sus puntos y guarda los nombres de todas sus escuelas.

Entrada:  datos/educacion/educacion_gran_resistencia.geojson (salida del 03)
Salida:   datos/educacion/escuelas_sitios_50m.geojson (EPSG:4326)
          + una copia en cada carpeta de COPIAS (scripts/rutas_locales.py)

CÓMO CORRERLO
-------------
Sin nada instalado aparte de Python 3:
    python 05_sitios_escuelas.py
También desde la consola de Python de QGIS (abrir y Ejecutar); al terminar
agrega el resultado al mapa.
"""

import inspect
import json
import math
import os
import runpy
import shutil


def _carpeta_de_este_script():
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
ENTRADA = os.path.join(PROYECTO, "datos", "educacion", "educacion_gran_resistencia.geojson")
SALIDA = os.path.join(PROYECTO, "datos", "educacion", "escuelas_sitios_50m.geojson")
COPIAS = LOCALES.get("COPIAS", [])
DISTANCIA_M = 50
DIAMETRO_MAX_M = 120

# Metros por grado en la latitud de Resistencia (alcanza para distancias cortas)
_KX = 111320 * math.cos(math.radians(27.45))
_KY = 110570


def distancia(a, b):
    return math.hypot((a[0] - b[0]) * _KX, (a[1] - b[1]) * _KY)


def punto(geom):
    c = geom["coordinates"]
    return tuple(c[0] if geom["type"] == "MultiPoint" else c)


def agrupar(indices, puntos, umbral):
    """Une en cadena los puntos a menos de 'umbral' metros. Devuelve listas de índices."""
    padre = {i: i for i in indices}

    def raiz(i):
        while padre[i] != i:
            padre[i] = padre[padre[i]]
            i = padre[i]
        return i

    for n, i in enumerate(indices):
        for j in indices[n + 1:]:
            if distancia(puntos[i], puntos[j]) < umbral:
                padre[raiz(i)] = raiz(j)
    grupos = {}
    for i in indices:
        grupos.setdefault(raiz(i), []).append(i)
    return list(grupos.values())


def diametro(grupo, puntos):
    return max((distancia(puntos[i], puntos[j]) for i in grupo for j in grupo), default=0)


def sitios(puntos):
    pendientes, listos = [list(range(len(puntos)))], []
    umbral = DISTANCIA_M
    while pendientes:
        siguientes = []
        for conjunto in pendientes:
            for g in agrupar(conjunto, puntos, umbral):
                (siguientes if len(g) > 1 and diametro(g, puntos) > DIAMETRO_MAX_M else listos).append(g)
        pendientes, umbral = siguientes, umbral * 0.7
    return listos


def main():
    datos = json.load(open(ENTRADA, encoding="utf-8"))["features"]
    puntos = [punto(f["geometry"]) for f in datos]
    grupos = sorted(sitios(puntos), key=lambda g: min(g))

    salida = []
    for n, g in enumerate(grupos, 1):
        lon = sum(puntos[i][0] for i in g) / len(g)
        lat = sum(puntos[i][1] for i in g) / len(g)
        nombres = sorted({(datos[i]["properties"].get("nombre") or "").strip() for i in g} - {""})
        tipos = sorted({(datos[i]["properties"].get("gna") or "").strip() for i in g} - {""})
        salida.append({"type": "Feature",
                       "properties": {"sitio": n, "escuelas": len(g),
                                      "nombre": " / ".join(nombres),
                                      "tipos": " / ".join(tipos),
                                      "diametro_m": round(diametro(g, puntos))},
                       "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]}})

    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "name": "escuelas_sitios_50m",
                   "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
                   "features": salida}, f, ensure_ascii=False)

    compartidos = [s for s in salida if s["properties"]["escuelas"] > 1]
    print(f"Escuelas: {len(datos)}  ->  sitios: {len(salida)}")
    print(f"Sitios con más de una escuela: {len(compartidos)} "
          f"(juntan {sum(s['properties']['escuelas'] for s in compartidos)} escuelas)")
    print(f"Mayor cantidad en un sitio: {max(s['properties']['escuelas'] for s in salida)}; "
          f"mayor diámetro: {max(s['properties']['diametro_m'] for s in salida)} m")
    print(f"Salida: {SALIDA}")
    for carpeta in COPIAS:
        os.makedirs(carpeta, exist_ok=True)
        shutil.copy2(SALIDA, carpeta)
        print(f"Copia en: {carpeta}")

    try:
        from qgis.core import QgsApplication, QgsProject, QgsVectorLayer
        if QgsApplication.instance() is not None:
            capa = QgsVectorLayer(SALIDA, "escuelas_sitios_50m", "ogr")
            if capa.isValid():
                QgsProject.instance().addMapLayer(capa)
    except ImportError:
        pass


main()
