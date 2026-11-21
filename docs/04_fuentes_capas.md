# Fuentes para las capas de contexto del índice de riesgo

Fecha: 2026-11-21. Verificar disponibilidad, licencia y fecha al descargar.

## Radios censales con población (capa_poblacion)
- Geometría: Rodriguez (CONICET, 2024), base de radios del censo 2022 revisada y corregida para SIG — https://ri.conicet.gov.ar/handle/11336/238198 (serie 1991–2022: https://ri.conicet.gov.ar/handle/11336/149711).
- Geometría + datos ya preparados: source.coop "censo-argentino/2022" (radios.parquet + census-data.parquet, unir cod_2022 ↔ id_geo) — https://source.coop/nlebovits/censo-argentino/2022. Variables no confirmadas: revisar que traiga población y viviendas.
- Datos oficiales por radio: INDEC, base REDATAM del Censo 2022.
- **Estado (2026-11-21):** geometría de Rodriguez descargada (radios2022_v1.0, WGS84, 66.502 radios, campos NOMPROV, PROV, NOMDEPTO, DEPTO, FRAC, RADIO, TIPO, LINK, OBS2020). **No trae población.** Recorte del Gran Resistencia en `datos/radios/` con `scripts/01_recorte_radios.py` (567 radios: San Fernando 529, Libertad 22, 1° de Mayo 16). Falta la población y las viviendas por radio desde REDATAM, para unir por `LINK` (código de 9 dígitos: provincia + departamento + fracción + radio).

## Escuelas (capa_escuelas)
- Mapa Educativo Nacional, capa "establecimiento_educativo" (padrón 09/2023) — https://mapa.educacion.gob.ar

## Centros de salud (capa_salud)
- REFES (Ministerio de Salud) en datos.gob.ar — https://www.datos.gob.ar/dataset/salud-listado-establecimientos-salud-asentados-registro-federal-refes. Confirmar si trae coordenadas; si no, geocodificar o complementar con OSM (amenity=hospital/clinic/doctors).

## Hidrografía (capa_agua)
- IGN, Capas SIG (cursos y espejos de agua) — https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/CapasSIG. Escala regional: puede no tener canales urbanos ni lagunas chicas.
- OpenStreetMap vía QuickOSM: natural=water, waterway=river/canal/drain/ditch. Probablemente más detallado en lo urbano.

## Zonas inundables (capa_inundable)
- APA Chaco: Res. 1111/98 (zonificación de restricciones por riesgo de inundación, AMGR) y Res. 303/17 (mapa de amenaza hídrica por crecidas, Gran Resistencia). Pedir la cartografía digital a APA o buscarla en IDE Chaco (http://idechaco.gob.ar).
- Alternativa propia: frecuencia de agua con JRC Global Surface Water en Earth Engine + MDE del IGN.

## Antecedentes locales útiles
- Da Silva, López y Arias — inundaciones en el AMGR (Revista Geográfica Norte Grande).
- Aeberhard (UNNE, FAU) — asentamientos en bordes de lagunas y riesgo hídrico, cita Res. APA 303/17.
- UNNE — proyecto IDE del Área Metropolitana del Gran Resistencia.
