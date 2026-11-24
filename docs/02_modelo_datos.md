# Modelo de datos v1 — tabla `reportes`

Fecha: 2026-11-21. Implementado en `neon/schema.sql` (probado en PostgreSQL 16 + PostGIS y contra una copia de la Data API).

## Columnas
- `id` uuid (lo genera el navegador; evita duplicados en reintentos sin señal)
- `creado_en` timestamptz
- `lat`, `lon` (WGS84) y `geom` Point 4326, que arma el trigger (para QGIS)
- Relevamiento opcional: `tipo` (domiciliario, verde_poda, escombros, mixto, neumaticos, otro), `tamano` (bolsas, carretilla, camioneta, camion_o_mas), `quema`, `cerca_agua`, `cerca_escuela`, `antiguedad` (dias, semanas, meses, mas_de_un_anio, no_se), `descripcion` (≤500)
- `foto_entrada` (texto, base64 que manda el navegador; el trigger la convierte y la vacía) y `foto` (binario guardado en la tabla)
- Moderación: `estado` (pendiente, verificado, en_gestion, resuelto, descartado), `foto_aprobada`, `revisado_en`, `nota_admin`, `tamano_moderado` (tamaño corregido por el moderador mirando la foto; el `tamano` del vecino no se toca)
- Desde 2026-11-24 el panel usa cuatro estados: pendiente, activo (`verificado`), ya no está (`resuelto`) y descartado. `en_gestion` queda en desuso y cuenta como activo.

## Reglas
- Público (rol `anonymous`, el que usan las funciones de `/api`): solo INSERT de las columnas del vecino; sin SELECT/UPDATE/DELETE.
- Área válida: lat −27,62 a −27,30; lon −59,15 a −58,85.
- Tope global 200 reportes/hora; rechazo de reportes a menos de 20 m de otro en los últimos 10 min.
- Vista `reportes_publicos`: solo verificado / en_gestion ("ya no está" no se publica), coordenadas redondeadas a 4 decimales, sin comentario ni foto; trae `tiene_foto`, el tamaño (corregido si lo hay) y `riesgo_clase` / `riesgo_total` de la tabla `riesgo_cache`.
- Función `foto_basural(id)`: devuelve la foto en base64, de a una, solo si está aprobada y el basural está activo.
- PostGIS en el esquema `gis`, separado de las tablas del proyecto.
- Mapa (desde 2026-11-24): color por clase de riesgo (alto rojo, medio amarillo, bajo verde) y tamaño del punto por tamaño del basural; borde punteado si no se informó. Antes el color era por estado (verificado rojo, en_gestion amarillo, resuelto verde).

## Página v1
Leaflet (mapa CARTO + satélite Esri), modo "Denunciar" con pin fijo al centro y botón "Mi ubicación", formulario con relevamiento desplegable, foto comprimida en el navegador (sin metadatos) y enviada dentro del reporte, cola sin señal en IndexedDB, campo trampa anti-bots.
