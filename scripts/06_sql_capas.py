# -*- coding: utf-8 -*-
"""
06_sql_capas.py
===============
Arma neon/capas_contexto.sql con las capas de contexto ya preparadas en datos/,
listo para pegar en el SQL Editor de Neon (o aplicarlo con psql).

Cada capa se reemplaza entera (delete + insert dentro de una transacción), así
que se puede volver a correr cuando cambie un recorte. Por ahora:

  capa_salud     <- datos/salud/salud_gran_resistencia.geojson       (02)
  capa_escuelas  <- datos/educacion/escuelas_sitios_50m.geojson      (05)
  capa_agua      <- datos/hidrografia/agua_contexto_gran_resistencia.geojson (07: IGN + OSM)

El IGN solo (salida del 04) no se carga: a escala de ciudad le faltan el río
Negro y las lagunas urbanas, y el índice tomaría "no hay agua cerca" como dato.

Las capas que todavía no existen en datos/ se saltean con un aviso.

    python 06_sql_capas.py
"""

import json
import os

PROYECTO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(PROYECTO, "neon", "capas_contexto.sql")

# tabla, archivo, columnas de texto además de nombre
CAPAS = [
    ("capa_salud", os.path.join("datos", "salud", "salud_gran_resistencia.geojson"), []),
    ("capa_escuelas", os.path.join("datos", "educacion", "escuelas_sitios_50m.geojson"), []),
    ("capa_agua", os.path.join("datos", "hidrografia", "agua_contexto_gran_resistencia.geojson"),
     ["tipo", "regimen", "capa"]),
]
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = -59.15, -27.62, -58.85, -27.30


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
    return (min(xs) >= LON_MIN - 1e-6 and max(xs) <= LON_MAX + 1e-6
            and min(ys) >= LAT_MIN - 1e-6 and max(ys) <= LAT_MAX + 1e-6)


def geometria(geom):
    """Puntos con st_makepoint; el resto (polígonos, líneas) desde GeoJSON."""
    if geom["type"] in ("Point", "MultiPoint"):
        lon, lat = punto(geom)
        return f"gis.st_setsrid(gis.st_makepoint({lon:.7f}, {lat:.7f}), 4326)"
    if not dentro(geom):
        raise ValueError("Geometría fuera del Gran Resistencia")
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
        valores = [texto(f["properties"].get(c)) for c in ["nombre"] + extras]
        filas.append(f"  ({', '.join(valores)}, {geometria(f['geometry'])})")
    columnas = ", ".join(["nombre"] + extras + ["geom"])
    partes += [f"\n-- {tabla}: {len(filas)} entidades, desde {ruta.replace(os.sep, '/')}",
               f"delete from public.{tabla};",
               f"insert into public.{tabla} ({columnas}) values\n" + ",\n".join(filas) + ";"]
    print(f"{tabla}: {len(filas)} entidades")
partes.append("\ncommit;\n")

with open(SALIDA, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(partes))
print(f"Salida: {SALIDA}")
