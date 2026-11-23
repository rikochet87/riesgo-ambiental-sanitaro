# -*- coding: utf-8 -*-
"""
08_poblacion_radios.py
======================
Une la población del Censo 2022 a los radios censales del Gran Resistencia,
para la capa_poblacion del índice de riesgo.

Fuente de la población: INDEC, base REDATAM del Censo 2022 (viviendas
particulares), consulta en línea del 2026-11-23:
  Resultados básicos > Viviendas particulares > Frecuencias > Población,
  variable "Sexo registrado al nacer", corte de área "Radio", área "Chaco".
  El total de cada radio es la cantidad de personas en viviendas
  particulares (no cuenta viviendas colectivas ni población en situación
  de calle). Chaco suma 1.124.603; los departamentos San Fernando, Libertad
  y 1° de Mayo, 441.804 en 609 radios.
Esos totales están en datos/poblacion/poblacion_radios_redatam_2022.csv
(link;poblacion), con el código de 9 dígitos que usa el campo LINK.

Entrada:  datos/radios/radios_gran_resistencia_2022.geojson (salida del 01)
          datos/poblacion/poblacion_radios_redatam_2022.csv
Salida:   datos/poblacion/radios_poblacion_gran_resistencia.geojson
          (campos codigo y poblacion; coordenadas a 6 decimales, ~10 cm)
          + copia en cada carpeta de COPIAS (scripts/rutas_locales.py)

Los radios sin dato en REDATAM (sin viviendas particulares) se dejan afuera:
para el índice es lo mismo que población cero.

    python 08_poblacion_radios.py      (o desde la consola de QGIS)

"Fuente: elaboración propia con base en datos del INDEC. Censo Nacional de
Población, Hogares y Viviendas 2022, procesado con Redatam."
"""

import csv
import inspect
import json
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

RADIOS = os.path.join(PROYECTO, "datos", "radios", "radios_gran_resistencia_2022.geojson")
POBLACION = os.path.join(PROYECTO, "datos", "poblacion", "poblacion_radios_redatam_2022.csv")
SALIDA = os.path.join(PROYECTO, "datos", "poblacion", "radios_poblacion_gran_resistencia.geojson")
COPIAS = LOCALES.get("COPIAS", [])


def redondear(c):
    return [redondear(x) for x in c] if isinstance(c, list) else round(float(c), 6)


def main():
    with open(POBLACION, encoding="utf-8") as f:
        poblacion = {fila["link"]: int(fila["poblacion"]) for fila in csv.DictReader(f, delimiter=";")}
    radios = json.load(open(RADIOS, encoding="utf-8"))["features"]

    salida, sin_dato = [], []
    for r in radios:
        link = r["properties"]["LINK"]
        if link not in poblacion:
            sin_dato.append(link)
            continue
        salida.append({"type": "Feature",
                       "properties": {"codigo": link, "poblacion": poblacion[link]},
                       "geometry": {"type": r["geometry"]["type"],
                                    "coordinates": redondear(r["geometry"]["coordinates"])}})

    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "name": "radios_poblacion_gran_resistencia",
                   "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
                   "features": salida}, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Radios: {len(radios)}  con población: {len(salida)}  sin dato en REDATAM: {len(sin_dato)}")
    if sin_dato:
        print("  Sin dato: " + ", ".join(sin_dato))
    print(f"Población en el área: {sum(s['properties']['poblacion'] for s in salida):,}".replace(",", "."))
    print(f"Salida: {SALIDA}")
    for carpeta in COPIAS:
        os.makedirs(carpeta, exist_ok=True)
        shutil.copy2(SALIDA, carpeta)
        print(f"Copia en: {carpeta}")

    try:
        from qgis.core import QgsApplication, QgsProject, QgsVectorLayer
        if QgsApplication.instance() is not None:
            capa = QgsVectorLayer(SALIDA, "radios_poblacion_gran_resistencia", "ogr")
            if capa.isValid():
                QgsProject.instance().addMapLayer(capa)
    except ImportError:
        pass


main()
