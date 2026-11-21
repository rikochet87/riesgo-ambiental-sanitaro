# Basurales Gran Resistencia — v1

Página web adaptativa (pensada para celular) donde los vecinos denuncian y relevan basurales sin crear una cuenta. Archivos estáticos para GitHub Pages + Supabase (plan gratuito).

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | Página: mapa, botón de denuncia, formulario y relevamiento |
| `styles.css` | Estilos (celular primero; en pantallas anchas el formulario va a la derecha) |
| `app.js` | Lógica: mapa, ubicación, foto, envío y cola sin señal |
| `config.js` | URL y clave anon de Supabase, área válida, centro del mapa |
| `supabase/schema.sql` | Tabla, permisos, reglas, topes, vista pública y bucket de fotos |

## Puesta en marcha

1. **Supabase:** creá el proyecto, abrí *SQL Editor*, pegá todo `supabase/schema.sql` y ejecutalo.
2. **Clave:** en *Project Settings > API* copiá la *Project URL* y la clave *anon public* en `config.js`.
3. **GitHub:** subí la carpeta a un repositorio y activá *Settings > Pages* (rama `main`, carpeta raíz).
   Con cuenta gratuita, Pages exige que el repositorio sea público. Es seguro: la clave anon está hecha para ser pública y la base solo permite insertar.
4. Abrí la URL de Pages desde el celular y probá un reporte.

## Cómo funciona la seguridad

- El público **solo inserta** reportes, y solo las columnas del vecino. No puede leer, editar ni borrar, ni cambiar el estado.
- Reglas en la base: punto dentro del Gran Resistencia, valores válidos en las listas, comentario de hasta 500 caracteres, la foto tiene que tener el mismo id que el reporte.
- **Topes:** 200 reportes por hora en total (se cambia en `reportes_control_insercion`) y rechazo de reportes a menos de 20 m de otro de los últimos 10 minutos.
- **Fotos:** el navegador las achica a 1280 px y unos 300 KB, y al redibujarlas se pierden los metadatos, incluida la ubicación GPS. El bucket es privado: se puede subir pero no listar ni descargar.
- **Mapa público:** lee solo la vista `reportes_publicos`, con reportes ya revisados, coordenadas redondeadas (~11 m) y sin comentario ni foto.
- **Bots:** campo trampa invisible; si se completa, no se envía nada.

## Moderar

Desde el panel de Supabase:

- *Table Editor > reportes*: filtrá `estado = pendiente`, revisá y cambiá el estado.
- *Storage > fotos > reportes*: las fotos, con el mismo id del reporte.
- Estados (semáforo del mapa público): `verificado` = rojo, `en_gestion` = amarillo, `resuelto` = verde, `descartado` = no se muestra.

Hay consultas listas al final de `schema.sql`.

## Índice de riesgo (popup de cada basural)

Al tocar un basural en el mapa, el popup muestra un índice de riesgo ambiental y sanitario de 0 a 100 (bajo / medio / alto) y sus cuatro componentes:

| Componente | Qué mide | De dónde sale |
| --- | --- | --- |
| Amenaza | Tamaño, frecuencia de quemas y crecimiento | Tabla `amenaza_satelital` (script de Earth Engine). Mientras no haya datos satelitales, se estima con el relevamiento vecinal: tamaño, quema y antigüedad |
| Exposición | Población y viviendas, escuelas y centros de salud a menos de 300 m | `capa_poblacion`, `capa_escuelas`, `capa_salud` |
| Vulnerabilidad ambiental | Distancia a lagunas, ríos y canales; si está en zona inundable | `capa_agua`, `capa_inundable` |
| Reportes vecinales | Reportes en rojo a menos de 300 m y días desde el más antiguo | La propia tabla `reportes` |

**Instalación:** ejecutar `supabase/riesgo.sql` después de `schema.sql`.

**Cargar las capas desde QGIS:**
1. En Supabase, *Connect > Session pooler*: copiá host, puerto, base y usuario.
2. En QGIS, *Navegador > PostgreSQL > Nueva conexión* con esos datos.
3. Reproyectá cada capa a **EPSG:4326** y cargala con *Base de datos > Administrador de BD > Importar capa* (o arrastrándola) **dentro de la tabla existente**, respetando las columnas:
   - `capa_poblacion`: `codigo`, `poblacion`, `viviendas`, `geom` (radios censales)
   - `capa_escuelas` / `capa_salud`: `nombre`, `geom` (puntos)
   - `capa_agua`: `nombre`, `tipo`, `geom` (lagunas como polígonos; ríos y canales como líneas)
   - `capa_inundable`: `nivel`, `geom` (polígonos)

Fuentes posibles (a verificar disponibilidad y licencia): radios censales con población del INDEC (Censo 2022), establecimientos educativos y de salud de los registros nacionales o provinciales, hidrografía del IGN u OpenStreetMap, zonas inundables de la Administración Provincial del Agua del Chaco.

**Sin capas:** si una capa no está cargada, ese factor aparece como "sin datos" y los pesos se reparten entre los demás. No se inventan valores.

**Ajustes:** pesos, radios y umbrales están en la tabla `parametros_riesgo` (una fila). Los valores iniciales (25% cada componente, 300 m de exposición, 500 m para agua) son provisorios: conviene calibrarlos con AHP y con basurales conocidos.

## Sin señal

Si el envío falla por falta de conexión, el reporte (con su foto) queda guardado en el navegador y se reintenta solo al recuperar la señal o al volver a abrir la página. El id lo genera el celular, así que un reintento nunca duplica el reporte.

## Pendiente para próximas versiones

- Respaldo CSV semanal con GitHub Actions (también evita la pausa de Supabase por 7 días sin uso).
- Fotos aprobadas visibles en el mapa público (copiarlas a un bucket público al aprobarlas).
- Captcha Cloudflare Turnstile con una función de Supabase, si aparece spam.
