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

Las capas que todavía no existen en datos/ se saltean con un aviso.

    python 06_sql_capas.py
"""

import json
import os

PROYECTO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(PROYECTO, "neon", "capas_contexto.sql")

CAPAS = [
    ("capa_salud", os.path.join("datos", "salud", "salud_gran_resistencia.geojson")),
    ("capa_escuelas", os.path.join("datos", "educacion", "escuelas_sitios_50m.geojson")),
]
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = -59.15, -27.62, -58.85, -27.30


def texto(valor):
    return "null" if not valor else "'" + str(valor).strip().replace("'", "''") + "'"


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
for tabla, ruta in CAPAS:
    archivo = os.path.join(PROYECTO, ruta)
    if not os.path.exists(archivo):
        print(f"Salteada {tabla}: falta {ruta}")
        continue
    entidades = json.load(open(archivo, encoding="utf-8"))["features"]
    filas = []
    for f in entidades:
        lon, lat = punto(f["geometry"])
        filas.append(f"  ({texto(f['properties'].get('nombre'))}, "
                     f"gis.st_setsrid(gis.st_makepoint({lon:.7f}, {lat:.7f}), 4326))")
    partes += [f"\n-- {tabla}: {len(filas)} puntos, desde {ruta.replace(os.sep, '/')}",
               f"delete from public.{tabla};",
               f"insert into public.{tabla} (nombre, geom) values\n" + ",\n".join(filas) + ";"]
    print(f"{tabla}: {len(filas)} puntos")
partes.append("\ncommit;\n")

with open(SALIDA, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(partes))
print(f"Salida: {SALIDA}")
