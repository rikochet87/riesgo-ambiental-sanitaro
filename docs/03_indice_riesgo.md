# Índice de riesgo ambiental y sanitario — v1

Fecha: 2026-11-21. Implementado en `supabase/riesgo.sql` (función `riesgo_basural(id)`), probado en PostgreSQL 16 + PostGIS con capas de ejemplo. Se muestra en el popup de cada basural revisado.

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
- Contexto (cargar desde QGIS en EPSG:4326): `capa_poblacion`, `capa_escuelas`, `capa_salud`, `capa_agua`, `capa_inundable`.
- Pesos, radios y umbrales editables en `parametros_riesgo`.

## Pendiente
- Calibrar pesos con AHP y basurales conocidos; justificar radios con la bibliografía (`05_bibliografia.md`).
- Conseguir las capas de contexto de Resistencia (`04_fuentes_capas.md`).
- Script de Earth Engine que complete `amenaza_satelital`.
