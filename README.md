# Basurales Gran Resistencia — v1

Página web adaptativa (pensada para celular) donde los vecinos denuncian y relevan basurales sin crear una cuenta. Archivos estáticos para GitHub Pages + Neon (plan gratuito).

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | Página: mapa, botón de denuncia, formulario y relevamiento |
| `styles.css` | Estilos (celular primero; en pantallas anchas el formulario va a la derecha) |
| `temas/` | Variantes de color y botones. La página usa `tema-monte.css` |
| `app.js` | Lógica: mapa, ubicación, foto, envío y cola sin señal |
| `config.js` | Dirección de la Data API, área válida y centro del mapa |
| `neon/schema.sql` | Tabla, permisos, reglas, topes, vista pública y fotos |
| `neon/riesgo.sql` | Índice de riesgo y capas de contexto |
| `scripts/` | Recortes de las capas al Gran Resistencia (ver `scripts/README.md`) |

## Puesta en marcha

1. **Neon:** creá un proyecto. Entrá a *Postgres database > Data API*, elegí la rama y tocá **Enable Data API**. Eso crea los roles `anonymous` y `authenticated` y te da la dirección REST.
2. **Base:** abrí el *SQL Editor*, pegá todo `neon/schema.sql` y ejecutalo. Después hacé lo mismo con `neon/riesgo.sql`.
3. **Dirección:** copiá la URL REST de la Data API (la que incluye `.apirest` y termina en `/rest/v1`) en `config.js`. No hay ninguna clave que copiar.
4. **Dominios permitidos:** en los ajustes de la Data API, poné la dirección de tu GitHub Pages en *CORS*. Si lo dejás vacío, cualquier sitio puede llamar a la API.
5. **Caché del esquema:** cada vez que cambies tablas o funciones, tocá *Refresh schema cache* en la Data API.
6. **GitHub:** subí la carpeta a un repositorio y activá *Settings > Pages* (rama `main`, carpeta raíz). Con cuenta gratuita, Pages exige que el repositorio sea público. Es seguro: la página no lleva claves y la base solo permite insertar.
7. Abrí la URL de Pages desde el celular y probá un reporte.

## Cómo funciona la seguridad

- La página **no usa ninguna clave**. Llama a la Data API como rol `anonymous`, y ese rol **solo puede insertar** reportes, con las columnas del vecino. No puede leer la tabla, ni editarla, ni borrarla, ni cambiar el estado.
- Reglas en la base: punto dentro del Gran Resistencia, valores válidos en las listas, comentario de hasta 500 caracteres, foto de hasta 400 KB.
- **Topes:** 200 reportes por hora en total (se cambia en `reportes_control_insercion`) y rechazo de reportes a menos de 20 m de otro de los últimos 10 minutos.
- **Fotos:** el navegador las achica a 1000 px y unos 200 KB, y al redibujarlas se pierden los metadatos, incluida la ubicación GPS. Viajan dentro del reporte y se guardan en la misma tabla. El público nunca lee esa columna: la foto se sirve de a una, ya aprobada, con la función `foto_basural()`.
- **Mapa público:** lee solo la vista `reportes_publicos`, con reportes ya revisados, coordenadas redondeadas (~11 m) y sin comentario ni foto.
- **PostGIS** vive en el esquema `gis`, no en `public`, para que la Data API no exponga sus funciones.
- **Bots:** campo trampa invisible; si se completa, no se envía nada.

## Moderar

Desde el *SQL Editor* de Neon. Hay consultas listas al final de `neon/schema.sql`:

- Listar pendientes (sin traer las fotos, que pesan).
- Ver una foto: exportarla en base64 y abrirla en el navegador como `data:image/jpeg;base64,<contenido>`.
- Aprobar: `update ... set estado = 'verificado', foto_aprobada = true, revisado_en = now()`.
- Estados (semáforo del mapa público): `verificado` = rojo, `en_gestion` = amarillo, `resuelto` = verde, `descartado` = no se muestra.

La foto solo aparece en el mapa si marcás `foto_aprobada`. El estado y la foto se aprueban por separado: podés publicar un basural sin publicar su foto.

## Índice de riesgo (popup de cada basural)

Al tocar un basural en el mapa, el popup muestra la foto (si está aprobada) y un índice de riesgo ambiental y sanitario de 0 a 100 (bajo / medio / alto) con sus cuatro componentes:

| Componente | Qué mide | De dónde sale |
| --- | --- | --- |
| Amenaza | Tamaño, frecuencia de quemas y crecimiento | Tabla `amenaza_satelital` (script de Earth Engine). Mientras no haya datos satelitales, se estima con el relevamiento vecinal: tamaño, quema y antigüedad |
| Exposición | Población y viviendas, escuelas y centros de salud a menos de 300 m | `capa_poblacion`, `capa_escuelas`, `capa_salud` |
| Vulnerabilidad ambiental | Distancia a lagunas, ríos y canales; si está en zona inundable | `capa_agua`, `capa_inundable` |
| Reportes vecinales | Reportes en rojo a menos de 300 m y días desde el más antiguo | La propia tabla `reportes` |

**Cargar las capas desde QGIS:**
1. En Neon, *Connect*: copiá host, base, usuario y contraseña de la conexión directa (no la del pooler).
2. En QGIS, *Navegador > PostgreSQL > Nueva conexión* con esos datos, puerto 5432 y modo SSL **require**.
3. Reproyectá cada capa a **EPSG:4326** y cargala con *Base de datos > Administrador de BD > Importar capa* **dentro de la tabla existente**, respetando las columnas:
   - `capa_poblacion`: `codigo`, `poblacion`, `viviendas`, `geom` (radios censales)
   - `capa_escuelas` / `capa_salud`: `nombre`, `geom` (puntos)
   - `capa_agua`: `nombre`, `tipo`, `regimen`, `capa`, `geom` (lagunas como polígonos; ríos y canales como líneas)
   - `capa_inundable`: `nivel`, `geom` (polígonos)

Las fuentes de cada capa están en `docs/04_fuentes_capas.md`.

**Sin capas:** si una capa no está cargada, ese factor aparece como "sin datos" y los pesos se reparten entre los demás. No se inventan valores.

**Ajustes:** pesos, radios y umbrales están en la tabla `parametros_riesgo` (una fila). Los valores iniciales (25% cada componente, 300 m de exposición, 500 m para agua) son provisorios: conviene calibrarlos con AHP y con basurales conocidos.

## Sin señal

Si el envío falla por falta de conexión, el reporte (con su foto) queda guardado en el navegador y se reintenta solo al recuperar la señal o al volver a abrir la página. El id lo genera el celular, así que un reintento nunca duplica el reporte.

## Límites del plan gratuito de Neon

- 1 GB por proyecto. Las fotos comparten ese espacio: a 200 KB cada una entran unas 4000.
- 5 GB de tráfico de salida por mes. La foto solo se descarga al tocar un punto.
- 100 horas de cómputo por mes. La base se duerme tras 5 minutos sin uso y despierta sola en el primer pedido, así que no hay que reactivarla a mano.
- No hay copias de seguridad automáticas: conviene exportar un CSV cada tanto.

## Pendiente para próximas versiones

- Respaldo CSV semanal con GitHub Actions.
- Captcha (Cloudflare Turnstile) si aparece spam.
- Si el proyecto crece, mover las fotos a un almacenamiento aparte y dejar en la base solo su dirección.
