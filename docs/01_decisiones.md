# Decisión: web de reportes de basurales (v1)

Fecha: 2026-11-21. Proyecto privado y personal, independiente de SIG Vial.

## Idea
Los vecinos marcan un basural en el mapa, con foto opcional, sin crear una cuenta.

## Alcance (actualizado 2026-11-21)
- Una sola página web adaptativa, pensada primero para celular.
- Desde esa misma página el vecino denuncia (reporte rápido) y releva el basural (datos opcionales más detallados).
- Sin app asociada: se descarta por la complejidad que agrega.

## Infraestructura
- **Vercel** (plan Hobby) para la página y para las funciones de `/api`, desde el 2026-11-22. Antes se pensaba en GitHub Pages; ver el cambio más abajo.
- **Base: Neon** (plan gratuito), desde el 2026-11-22. Antes se había diseñado sobre Supabase, pero el cupo de 2 proyectos gratuitos ya estaba ocupado. Neon da 100 proyectos con 1 GB cada uno, trae PostGIS y su Data API es compatible con PostgREST, así que el modelo de seguridad se mantuvo casi igual.

## Seguridad (las reglas viven en la base)
- El rol `anonymous` solo puede insertar reportes: no puede leer la tabla, ni editarla, ni borrarla, ni cambiar el estado. Las funciones de `/api` trabajan siempre con ese rol.
- La página no lleva ninguna clave; la contraseña de la base está solo en Vercel.
- Reglas en la base que validan los datos, más un tope de reportes por hora.
- Las fotos se achican en el navegador, lo que borra la ubicación que trae el archivo.
- PostGIS va en el esquema `gis`, separado de las tablas del proyecto.
- Opcional: captcha (Cloudflare Turnstile) si aparece spam.

## Privacidad
- Las fotos no se publican hasta que alguien las revisa.
- Nunca se muestra quién reportó.

## Fotos
Se guardan dentro de la tabla, no en un almacenamiento aparte: Neon no tiene uno estable para subir desde el navegador. El vecino manda la foto en base64, la base la convierte a binario y solo se publica cuando se la aprueba. Se sirve de a una, al tocar el punto.

## Límites del plan gratuito (Neon)
- 1 GB por proyecto, compartido entre datos y fotos: unas 4000 fotos de 200 KB.
- 5 GB de tráfico por mes. Por eso la foto se muestra solo al tocar un reporte.
- 100 horas de cómputo por mes; la base se duerme sola y despierta en el primer pedido, sin reactivarla a mano.

## Riesgos
- No hay copias de seguridad automáticas: hace falta una exportación periódica (por ejemplo, un CSV con una tarea programada de GitHub Actions).
- Si el proyecto crece, las fotos van a necesitar un almacenamiento aparte.

## Para reusar
Las secciones de fauna y del semáforo de SIG Vial ya tienen resueltos la cola sin señal, los topes, la limpieza de fotos y la moderación.

## Cambio 2026-11-22: de la Data API de Neon a funciones de Vercel
El diseño original tenía a la página hablando directo con la Data API de Neon, sin servidor. Al desplegar se vio que la Data API exige un JWT en todo pedido, incluso el anónimo (la documentación de Neon se contradice en ese punto). La alternativa de Neon, un token anónimo emitido por Neon Auth, se probó y su servicio no respondió.

Se pasó a funciones de Vercel en `/api`:
- **Un solo host** en el camino: si la página carga, el resto funciona. Con Neon Auth eran dos servicios que tenían que estar arriba.
- **La base deja de tener un acceso público.** Solo la alcanzan las funciones, con una contraseña que vive en Vercel.
- **La seguridad no se movió:** cada función se baja al rol `anonymous` antes de cada consulta, así que siguen mandando los mismos permisos de la base.
- Costo: unas 150 líneas de backend para mantener, cubiertas por pruebas (`pruebas/`).

Las pruebas encontraron dos errores, ya corregidos:
- Al reintentar un reporte que sí había llegado, el trigger contestaba "ya hay uno en ese lugar" (encontraba al mismo reporte) en vez de "ya está cargado". Venía del diseño original. Ahora el control de duplicados ignora el propio id.
- La página tomaba cualquier respuesta 409 como "ya estaba cargado". Un vecino que reportaba donde ya había otro reporte reciente veía "¡Gracias!" sin que se guardara nada. Ahora se decide por el código de error, no por el estado HTTP.

## Eliminar reportes desde el panel (2026-11-22)
El rol `moderador` se diseñó sin permiso para borrar, como red de seguridad ante un error del panel. A pedido, se le dio `delete` sobre `reportes` para poder eliminar un reporte entero (casos: datos personales, pruebas, contenido que no debe quedar guardado). Lo compensan:
- Confirmación en la ficha, con el foco en "Cancelar"; `Esc` cancela antes de cerrar la ficha.
- La confirmación sugiere Descartar (que conserva el reporte) y avisa si no hay copia de seguridad reciente.
- El servidor exige sesión, mismo sitio y JSON, igual que cualquier cambio.
- El moderador sigue sin poder mover la ubicación ni editar lo que escribió el vecino.

## Tamaño corregido por el moderador (2026-11-24)
El tamaño que indica el vecino (bolsas, carretilla, camioneta, camión o más) varía según quién lo estime. Se agregó `tamano_moderado`: el moderador lo corrige mirando la foto desde la ficha del panel. Se eligió esta opción entre otras (preguntar en pasos y altura, dibujos de referencia, dibujar el contorno en el mapa, confirmación de otros vecinos) porque no le pide nada más al vecino y una sola persona aplica un criterio parejo.
- Lo del vecino queda en `tamano`, sin tocar; el moderador sigue sin poder editarlo.
- El índice y el mapa público usan `coalesce(tamano_moderado, tamano)`. Si hay superficie satelital, esa manda.
- El popup avisa "Tamaño revisado con la foto". La copia de seguridad trae las dos columnas.
- Pendiente: alinear las categorías con la escala del satélite (hoy "camión o más" vale lo mismo que 5000 m²).

## Mapa por riesgo y tamaño; estados simplificados (2026-11-24)
Los colores por estado (activo, en gestión, resuelto) suponían un seguimiento de la gestión que el sistema no hace. Ahora:
- **Color** del punto: clase del índice (alto, medio, bajo), con los tonos del tema. **Tamaño** del punto: tamaño del basural (el corregido por el moderador, si lo hay); borde punteado si no se informó.
- **Estados:** pendiente, activo (`verificado`), ya no está (`resuelto`, no se publica) y descartado. `en_gestion` queda en desuso y cuenta como activo.
- El índice de cada activo se guarda en `riesgo_cache` (calcularlo tarda ~25 ms): se recalcula al moderar (el reporte y sus activos a 300 m), al cargar capas o satélite (todos) y en las visitas (hasta 20 de más de un día).
- Alternativas consideradas: color por tamaño solo (deja afuera exposición y agua) y color por riesgo solo.

## Puntos a resolver
- El plan Hobby de Vercel es para uso personal y no comercial. Si el proyecto lo adoptara un organismo, haría falta otro plan.
- Tope por hora sin cuentas: un tope global en la base es simple y seguro. Un tope por IP es fácil de eludir; para eso sirve Turnstile.
- Copias de seguridad (2026-11-22): se descartó la exportación automática con GitHub Actions, porque el repositorio es público y la copia tiene datos privados (fotos sin aprobar, descripciones, ubicaciones exactas). También se descartó subir directo a Google Drive: con una cuenta personal, las cuentas de servicio no tienen cuota y el token de OAuth en modo de prueba vence cada 7 días. Quedó un botón en el panel que descarga un ZIP (GeoJSON, CSV, fotos) para guardar en la compu o en Drive, con aviso si pasa una semana sin copia. Es manual: protege solo si se hace.
