# Modelo de datos v1 — tabla `reportes`

Fecha: 2026-11-21. Implementado en `supabase/schema.sql` (probado en PostgreSQL 16 + PostGIS).

## Columnas
- `id` uuid (lo genera el navegador; evita duplicados en reintentos sin señal)
- `creado_en` timestamptz
- `lat`, `lon` (WGS84) y `geom` Point 4326 calculada (para QGIS)
- Relevamiento opcional: `tipo` (domiciliario, verde_poda, escombros, mixto, neumaticos, otro), `tamano` (bolsas, carretilla, camioneta, camion_o_mas), `quema`, `cerca_agua`, `cerca_escuela`, `antiguedad` (dias, semanas, meses, mas_de_un_anio, no_se), `descripcion` (≤500)
- `foto_path` = `reportes/<id>.jpg` en el bucket privado `fotos`
- Moderación: `estado` (pendiente, verificado, en_gestion, resuelto, descartado), `foto_aprobada`, `revisado_en`, `nota_admin`

## Reglas
- Público (anon): solo INSERT de las columnas del vecino; sin SELECT/UPDATE/DELETE.
- Área válida: lat −27,62 a −27,30; lon −59,15 a −58,85.
- Tope global 200 reportes/hora; rechazo de reportes a menos de 20 m de otro en los últimos 10 min.
- Vista `reportes_publicos`: solo verificado / en_gestion / resuelto, coordenadas redondeadas a 4 decimales, sin comentario ni foto.
- Semáforo: verificado = rojo, en_gestion = amarillo, resuelto = verde.

## Página v1
Leaflet (calles OSM + satélite Esri), modo "Denunciar" con pin fijo al centro y botón "Mi ubicación", formulario con relevamiento desplegable, foto comprimida en el navegador (sin metadatos), cola sin señal en IndexedDB, campo trampa anti-bots.
