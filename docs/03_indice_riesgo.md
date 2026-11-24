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
- Tamaño del vecino: si el moderador lo corrigió mirando la foto (`tamano_moderado`, desde 2026-11-24), se usa la corrección.
- Satélite: tabla `amenaza_satelital` (area_m2, quemas_12m, crecimiento_pct), la carga `scripts/09_quemas_ee.js` (Earth Engine). Desde 2026-11-24 cada dato satelital completa su parte por separado: superficie y crecimiento, si están, reemplazan lo del vecino; las quemas se combinan y queda la señal más alta (el satélite no borra una quema informada). Fuente: "relevamiento", "mixta" o "satelite". Por ahora el script solo mide quemas.
- Contexto (EPSG:4326): `capa_poblacion`, `capa_escuelas`, `capa_salud`, `capa_agua`, `capa_inundable`. Se cargan con `neon/capas_contexto.sql` (generado por `scripts/06_sql_capas.py`).
- Cargadas (2026-11-23): `capa_salud` (42 establecimientos del IGN) y `capa_escuelas` (357 sitios: las 494 escuelas del Mapa Educativo agrupadas a 50 m, para no contar dos veces un edificio con varios turnos o niveles).
- `capa_agua` (2026-11-23): unión del IGN, las lagunas urbanas de la IDE Chaco y OpenStreetMap (`scripts/07_agua_osm.py`), 770 entidades entre lagunas, ríos, riachos, canales y desagües a cielo abierto. El IGN solo no servía: no tiene el río Negro ni las lagunas urbanas. Datos de OSM © colaboradores de OpenStreetMap (ODbL), citados en el popup del índice.
- `capa_poblacion` (2026-11-23): 565 radios censales 2022 con su población en viviendas particulares (REDATAM del INDEC), 427.809 personas en el área. El índice reparte la población de cada radio según la parte de su área que cae dentro de los 300 m.
- Para cargar una sola capa: `neon/capas/<tabla>.sql`.
- `capa_inundable` queda vacía (2026-11-23): no se consiguió la cartografía de zonas inundables (APA Chaco, Res. 1111/98 y 303/17; no está publicada en la IDE Chaco). Con la tabla vacía, el índice deja ese factor afuera y la vulnerabilidad sale solo de la cercanía al agua. Si aparece la capa, se suma a `scripts/06_sql_capas.py` y se carga igual que las demás. Una aproximación posible es la frecuencia de agua superficial del JRC (Global Surface Water) en Earth Engine, junto con la amenaza satelital.
- Ojo al leer cambios: un factor "sin datos" queda fuera del promedio, pero al cargar su capa entra con su valor real, que puede ser bajo. Por eso un reporte puede bajar de puntaje al encenderse una capa (el primer reporte real pasó de 43 a 37: tiene 1 escuela y ningún centro de salud a 300 m).
- Pesos, radios y umbrales editables en `parametros_riesgo`.

## Pendiente
- Calibrar pesos con AHP y basurales conocidos; justificar radios con la bibliografía (`05_bibliografia.md`).
- Conseguir las capas de contexto de Resistencia (`04_fuentes_capas.md`).
- Superficie y crecimiento satelitales, calibrados con basurales confirmados.
