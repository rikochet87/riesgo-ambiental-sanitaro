# -*- coding: utf-8 -*-
"""
06_sql_capas.py
===============
Arma neon/capas_contexto.sql con las capas de contexto ya preparadas en datos/
(y neon/capas/<tabla>.sql, una por capa, para cargar solo la que cambió),
listo para pegar en el SQL Editor de Neon (o aplicarlo con psql).

Cada capa se reemplaza entera (delete + insert dentro de una transacción), así
que se puede volver a correr cuando cambie un recorte. Por ahora:

  capa_salud     <- datos/salud/salud_gran_resistencia.geojson       (02)
  capa_escuelas  <- datos/educacion/escuelas_sitios_50m.geojson      (05)
  capa_agua      <- datos/hidrografia/agua_contexto_gran_resistencia.geojson (07: IGN + OSM)
  capa_poblacion <- datos/poblacion/radios_poblacion_gran_resistencia.geojson (08)

El IGN solo (salida del 04) no se carga: a escala de ciudad le faltan el río
Negro y las lagunas urbanas, y el índice tomaría "no hay agua cerca" como dato.

Las capas que todavía no existen en datos/ se saltean con un aviso.

    python 06_sql_capas.py
"""

import json
import os

PROYECTO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(PROYECTO, "neon", "capas_contexto.sql")
POR_CAPA = os.path.join(PROYECTO, "neon", "capas")    # un archivo por capa, para cargar solo la que cambió

# tabla, archivo, columnas además de geom: "col" es texto, ("col", "int") es entero.
# Si la lista no incluye "nombre", la tabla no lo lleva.
CAPAS = [
    ("capa_salud", os.path.join("datos", "salud", "salud_gran_resistencia.geojson"), ["nombre"]),
    ("capa_escuelas", os.path.join("datos", "educacion", "escuelas_sitios_50m.geojson"), ["nombre"]),
    ("capa_agua", os.path.join("datos", "hidrografia", "agua_contexto_gran_resistencia.geojson"),
     ["nombre", "tipo", "regimen", "capa"]),
    ("capa_poblacion", os.path.join("datos", "poblacion", "radios_poblacion_gran_resistencia.geojson"),
     ["codigo", ("poblacion", "int")]),
]
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = -59.15, -27.62, -58.85, -27.30


def entero(valor):
    if valor is None or valor == "":
        return "null"
    return str(int(valor))


def texto(valor):
    return "null" if not valor else "'" + str(valor).strip().replace("'", "''") + "'"


def redondear(c):
    return [redondear(x) for x in c] if isinstance(c, list) else round(float(c), 7)


def dentro(geom):
    xs, ys = [], []

    def juntar(c):
        if isinstance(c[0], list):
            for x in c:
                juntar(x)
        else:
            xs.append(c[0]); ys.append(c[1])
    juntar(geom["coordinates"])
    # alcanza con que toque el área: un radio censal rural se sale del rectángulo
    return (max(xs) >= LON_MIN and min(xs) <= LON_MAX
            and max(ys) >= LAT_MIN and min(ys) <= LAT_MAX)


def geometria(geom):
    """Puntos con st_makepoint; el resto (polígonos, líneas) desde GeoJSON."""
    if geom["type"] in ("Point", "MultiPoint"):
        lon, lat = punto(geom)
        return f"gis.st_setsrid(gis.st_makepoint({lon:.7f}, {lat:.7f}), 4326)"
    if not dentro(geom):
        raise ValueError("Geometría que no toca el Gran Resistencia")
    gj = json.dumps({"type": geom["type"], "coordinates": redondear(geom["coordinates"])},
                    separators=(",", ":"))
    return f"gis.st_setsrid(gis.st_geomfromgeojson('{gj}'), 4326)"


def punto(geom):
    c = geom["coordinates"]
    if geom["type"] == "MultiPoint":
        if len(c) != 1:
            raise ValueError(f"MultiPoint con {len(c)} puntos")
        c = c[0]
    elif geom["type"] != "Point":
        raise ValueError(f"Geometría {geom['type']}: se esperaban puntos")
    lon, lat = float(c[0]), float(c[1])
    if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
        raise ValueError(f"Punto fuera del Gran Resistencia: {lon}, {lat}")
    return lon, lat


RECALCULAR_CAPA = "\n-- Índice guardado de los activos, con la capa nueva\nselect public.riesgo_recalcular_todo();"
partes = ["-- Generado por scripts/06_sql_capas.py. No editar a mano: volver a correr el script.",
          "begin;"]
for tabla, ruta, extras in CAPAS:
    archivo = os.path.join(PROYECTO, ruta)
    if not os.path.exists(archivo):
        print(f"Salteada {tabla}: falta {ruta}")
        continue
    entidades = json.load(open(archivo, encoding="utf-8"))["features"]
    filas = []
    for f in entidades:
        valores = [entero(f["properties"].get(c[0])) if isinstance(c, tuple)
                   else texto(f["properties"].get(c)) for c in extras]
        filas.append(f"  ({', '.join(valores)}, {geometria(f['geometry'])})")
    columnas = ", ".join([c[0] if isinstance(c, tuple) else c for c in extras] + ["geom"])
    bloque = [f"\n-- {tabla}: {len(filas)} entidades, desde {ruta.replace(os.sep, '/')}",
              f"delete from public.{tabla};",
              f"insert into public.{tabla} ({columnas}) values\n" + ",\n".join(filas) + ";"]
    partes += bloque
    os.makedirs(POR_CAPA, exist_ok=True)
    with open(os.path.join(POR_CAPA, f"{tabla}.sql"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join([partes[0], "begin;"] + bloque + [RECALCULAR_CAPA, "\ncommit;\n"]))
    print(f"{tabla}: {len(filas)} entidades")
# Recalcular el índice guardado de los basurales activos (el mapa se pinta por riesgo)
RECALCULAR = "\n-- Índice guardado de los activos, con las capas nuevas\nselect public.riesgo_recalcular_todo();"
partes.append(RECALCULAR)
partes.append("\ncommit;\n")

with open(SALIDA, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(partes))
print(f"Salida: {SALIDA}")
