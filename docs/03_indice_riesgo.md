# Índice de riesgo ambiental y sanitario — v1

Fecha: 2026-11-21. Implementado en `neon/riesgo.sql`, probado en PostgreSQL 16 + PostGIS con capas de ejemplo.

El cálculo está en `riesgo_calculo(id, solo_publicados)`, que nadie puede llamar directo. Se llega por dos funciones (2026-11-22):
- `riesgo_basural(id)`: la del público (rol `anonymous`), solo para basurales revisados. Se muestra en el popup del mapa público.
- `riesgo_basural_moderacion(id)`: la del panel (rol `moderador`, en `neon/moderacion.sql`), para cualquier reporte, también pendientes. Se muestra en el popup del visor de moderación.

Las dos dan el mismo resultado para un reporte publicado. El bloque que lo dibuja es `indice.js`, compartido por los dos popups.

## Fórmula
Riesgo (0–100) = 100 × promedio ponderado de 4 componentes (0–1). Clases: bajo < 34 ≤ medio < 67 ≤ alto.
Si falta una capa, ese factor queda "sin datos" y su peso se reparte entre los demás.

| Componente | Peso inicial | Cálculo |
| --- | --- | --- |
| Amenaza | 25% | Promedio de tamaño (área/5000 m²), quemas (n/4 en 12 meses) y crecimiento (%/100). Sin satélite: tamaño del relevamiento (bolsas 0,1 · carretilla 0,3 · camioneta 0,6 · camión 1), quema (0/1) y antigüedad (días 0,2 · semanas 0,4 · meses 0,7 · +1 año 1) |
| Exposición | 25% | 50% población en 300 m (proporcional al área del radio censal; máx. 2000) + 25% escuelas (máx. 2) + 25% centros de salud (máx. 1) |
| Vulnerabilidad | 25% | 60% agua (1 hasta 50 m, baja lineal a 0 en 500 m) + 40% zona inundable (0/1) |
| Reportes vecinales | 25% | 50% reportes verificados a < 300 m (máx. 5) + 50% días del más antiguo (máx. 180) |

## Datos
- Satélite: tabla `amenaza_satelital` (area_m2, quemas_12m, crecimiento_pct), la cargará el script de Earth Engine.
- Contexto (EPSG:4326): `capa_poblacion`, `capa_escuelas`, `capa_salud`, `capa_agua`, `capa_inundable`. Se cargan con `neon/capas_contexto.sql` (generado por `scripts/06_sql_capas.py`).
- Cargadas (2026-11-23): `capa_salud` (42 establecimientos del IGN) y `capa_escuelas` (357 sitios: las 494 escuelas del Mapa Educativo agrupadas a 50 m, para no contar dos veces un edificio con varios turnos o niveles).
- `capa_agua` está vacía a propósito (2026-11-23): el IGN solo no tiene el río Negro ni las lagunas urbanas, y cargado dejaba los reportes a kilómetros del agua. Se carga cuando esté la unión IGN + OpenStreetMap (`scripts/07_agua_osm.py`).
- Ojo al leer cambios: un factor "sin datos" queda fuera del promedio, pero al cargar su capa entra con su valor real, que puede ser bajo. Por eso un reporte puede bajar de puntaje al encenderse una capa (el primer reporte real pasó de 43 a 37: tiene 1 escuela y ningún centro de salud a 300 m).
- Pesos, radios y umbrales editables en `parametros_riesgo`.

## Pendiente
- Calibrar pesos con AHP y basurales conocidos; justificar radios con la bibliografía (`05_bibliografia.md`).
- Conseguir las capas de contexto de Resistencia (`04_fuentes_capas.md`).
- Script de Earth Engine que complete `amenaza_satelital`.
