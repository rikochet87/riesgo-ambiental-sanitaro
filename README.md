# Basurales Gran Resistencia — v1

Página web adaptativa (pensada para celular) donde los vecinos denuncian y relevan basurales sin crear una cuenta. Publicada en Vercel (página estática + funciones en `/api`) con la base en Neon, ambos en plan gratuito.

En línea: https://riesgo-ambiental-sanitaro.vercel.app

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | Página: mapa, botón de denuncia, formulario y relevamiento |
| `styles.css` | Estilos (celular primero; en pantallas anchas el formulario va a la derecha) |
| `temas/` | Variantes de color y botones. La página usa `tema-monte.css` |
| `app.js` | Lógica: mapa, ubicación, foto, envío y cola sin señal |
| `config.js` | Área válida y centro del mapa |
| `api/` | Funciones de Vercel: lo único que habla con la base (ver abajo) |
| `vercel.json` | Región de las funciones (São Paulo) y cabeceras de seguridad, CSP incluida |
| `package.json` | Dependencias de las funciones y comandos `npm test` / `npm run local` |
| `pruebas/` | Pruebas de `/api` y un servidor local que imita a Vercel |
| `neon/schema.sql` | Tabla, permisos, reglas, topes, vista pública y fotos |
| `neon/riesgo.sql` | Índice de riesgo y capas de contexto |
| `neon/moderacion.sql` | Rol `moderador`, tope de intentos de entrada y registro de copias de seguridad |
| `admin.html`, `admin.js`, `admin.css` | Panel de moderación (`/admin`) |
| `admin-zip.js` | Arma el ZIP de la copia de seguridad en el navegador |
| `indice.js` | Bloque del índice de riesgo, compartido por el popup público y el del panel |
| `scripts/` | Recortes de las capas al Gran Resistencia (ver `scripts/README.md`) |

## Puesta en marcha

1. **Neon:** creá un proyecto. En el *SQL Editor* pegá y ejecutá, en este orden, `neon/schema.sql`, `neon/riesgo.sql` y `neon/moderacion.sql`. Los roles `anonymous` y `moderador` se crean solos si faltan.
2. **Vercel:** importá el repositorio (*Add New > Project*). No lleva comando de build: Vercel publica los archivos y arma las funciones de `api/`.
3. **Conexión:** en Neon, *Connect* → copiá la cadena de conexión (`postgresql://...`). En Vercel, *Settings > Environment Variables*, creá `DATABASE_URL` con ese valor. Esa cadena lleva la contraseña: va solo ahí, nunca al repositorio ni a la página.
4. **Clave del panel:** en el mismo lugar creá `ADMIN_CLAVE`, de al menos 12 caracteres (mejor una frase larga). Volvé a desplegar para que tome las dos variables.
5. Abrí la URL de Vercel desde el celular y probá un reporte.

Cada `git push` a `main` vuelve a desplegar solo.

### Probar en tu computadora

Con un PostgreSQL + PostGIS local y una base `prueba_api` con los dos `.sql` cargados:

- `npm test`: prueba las funciones de `/api` y `/api/admin`, incluidos los intentos de abuso.
- `npm run local`: sirve la página y `/api` en `http://localhost:8000`, con las mismas cabeceras que Vercel.

## Cómo funciona la seguridad

- La página **no lleva ninguna clave** y nunca habla con la base: habla con las funciones de `/api`, en el mismo dominio. La contraseña de la base vive solo en Vercel.
- Cada función abre una transacción y lo primero que hace es `set local role anonymous`: trabaja con los permisos del público. Ese rol **solo puede insertar** reportes, con las columnas del vecino; no puede leer la tabla, ni editarla, ni borrarla, ni cambiar el estado. Si algún día una función tuviera un error, la base igual la frenaría.
- La lista de columnas que acepta el alta es fija: cualquier otra clave del JSON (`estado`, `foto_aprobada`...) se descarta.
- La página solo puede conectarse con su propio dominio (`connect-src 'self'` en la CSP de `vercel.json`).
- Reglas en la base: punto dentro del Gran Resistencia, valores válidos en las listas, comentario de hasta 500 caracteres, foto de hasta 400 KB.
- **Topes:** 200 reportes por hora en total (se cambia en `reportes_control_insercion`) y rechazo de reportes a menos de 20 m de otro de los últimos 10 minutos.
- **Fotos:** el navegador las achica a 1000 px y unos 200 KB, y al redibujarlas se pierden los metadatos, incluida la ubicación GPS. Viajan dentro del reporte y se guardan en la misma tabla. El público nunca lee esa columna: la foto se sirve de a una, ya aprobada, con la función `foto_basural()`.
- **Mapa público:** lee solo la vista `reportes_publicos`, con reportes ya revisados, coordenadas redondeadas (~11 m) y sin comentario ni foto.
- **PostGIS** vive en el esquema `gis`, no en `public`, separado de las tablas del proyecto.
- **Bots:** campo trampa invisible; si se completa, no se envía nada.

## Moderar

Desde **`/admin`** (https://riesgo-ambiental-sanitaro.vercel.app/admin), con la clave `ADMIN_CLAVE`. Es un visor GIS:

- **Mapa con todos los reportes** en sus coordenadas exactas (el mapa público las redondea), coloreados por estado. Los pendientes, en azul índigo, se dibujan más grandes y por encima. Mapa base de calles o satélite.
- **Capas por estado** que se prenden y apagan: pendientes, activos (rojo), en gestión (amarillo), resueltos (verde) y descartados (gris, apagados al abrir). La lista sigue a las capas prendidas.
- **Tocar un punto** (o una fila de la lista) abre el **popup con el índice de riesgo**, el mismo que ve el público, pero también para pendientes y descartados, que sirve para priorizar qué revisar primero. En la compu se abre además la ficha en el panel; en el celular el popup trae un botón "Moderar este reporte" que lleva a la ficha.
- **La ficha** muestra la foto aunque no esté aprobada, los datos del relevamiento, la descripción, un enlace a Google Maps y los botones de moderar. El punto queda marcado con un anillo. `Esc` vuelve a la lista.
- **Publicar** pasa un pendiente a activo, con o sin su foto; el punto cambia de color en el acto. **Descartar** lo saca del circuito sin borrarlo. En los ya revisados se cambia el estado y se publica o despublica la foto.
- **Quitar la foto** la borra de la base (para una cara, una patente o algo ofensivo). Pide un segundo toque porque no tiene vuelta atrás.
- Nota interna por reporte, que nunca se publica.
- En la compu, el panel va a la izquierda y el mapa a la derecha. En el celular, el mapa ocupa la pantalla y el panel es una hoja que sube desde abajo: baja (resumen y capas), media (ficha con el punto a la vista) o alta (lista).

Lo publicado puede tardar un par de minutos en verse en el mapa: la CDN de Vercel guarda la lista unos minutos.

### Copia de seguridad

El botón **Descargar copia de seguridad** del panel baja un ZIP a la compu con:

- `reportes.geojson`: todos los reportes con todos sus datos y las coordenadas completas. Se abre en QGIS y es la fuente para restaurar.
- `reportes.csv`: lo mismo para Excel (punto y coma, coma decimal, fechas en hora de Argentina). Los textos del vecino que empiezan con `=`, `+`, `-` o `@` llevan un apóstrofo adelante para que Excel no los ejecute como fórmula.
- `fotos/<id>.jpg`: todas las fotos, aprobadas o no.
- `LEEME.txt`: qué es cada cosa y cómo restaurar.

El ZIP se arma en el navegador porque Vercel no deja que una función devuelva más de 4,5 MB. Con muchas fotos, conviene hacerla desde la compu. El panel avisa en amarillo si pasa una semana sin copia.

**La copia es privada:** tiene fotos sin aprobar, descripciones y ubicaciones exactas, también de los descartados. Guardala en la compu o en Drive, nunca en el repositorio, que es público.

**Seguridad del panel:**
- La sesión es una cookie firmada, válida 8 horas, que solo viaja a `/api/admin`, no la puede leer JavaScript y no se manda desde otros sitios. Cambiar `ADMIN_CLAVE` cierra todas las sesiones.
- Con 10 claves incorrectas en 15 minutos se bloquea la entrada (incluso con la correcta) hasta que pasen.
- Las funciones del panel trabajan con el rol `moderador` de la base, que puede leer reportes y cambiar estado, foto y nota, pero **no puede borrar reportes ni mover su ubicación**, aunque el código tuviera un error.
- Lo que escribe el vecino se muestra siempre como texto, nunca como HTML.

También se puede moderar desde el *SQL Editor* de Neon; hay consultas listas al final de `neon/schema.sql`.

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

Si el envío falla por falta de conexión o por un error del servidor, el reporte (con su foto) queda guardado en el navegador y se reintenta solo al recuperar la señal o al volver a abrir la página. El id lo genera el celular, así que un reintento nunca duplica el reporte. Un rechazo de la base (datos inválidos, otro reporte en el mismo lugar, tope por hora) se le muestra al vecino y no se reintenta.

## Límites del plan gratuito de Neon

- 1 GB por proyecto. Las fotos comparten ese espacio: a 200 KB cada una entran unas 4000.
- 5 GB de tráfico de salida por mes. La foto solo se descarga al tocar un punto, y la CDN de Vercel guarda unos minutos la lista del mapa, las fotos y los índices, así que la mayoría de las visitas ni despiertan la base.
- 100 horas de cómputo por mes. La base se duerme tras 5 minutos sin uso y despierta sola en el primer pedido, así que no hay que reactivarla a mano.
- No hay copias de seguridad automáticas: Neon gratis solo vuelve atrás 6 horas. La copia se descarga desde el panel y depende de que alguien la haga; el panel avisa si pasa una semana.

## Pendiente para próximas versiones

- Respaldo CSV semanal con GitHub Actions.
- Captcha (Cloudflare Turnstile) si aparece spam.
- Si el proyecto crece, mover las fotos a un almacenamiento aparte y dejar en la base solo su dirección.
