# Decisión: web de reportes de basurales (v1)

Fecha: 2026-11-21. Proyecto privado y personal, independiente de SIG Vial.

## Idea
Los vecinos marcan un basural en el mapa, con foto opcional, sin crear una cuenta.

## Alcance (actualizado 2026-11-21)
- Una sola página web adaptativa, pensada primero para celular.
- Desde esa misma página el vecino denuncia (reporte rápido) y releva el basural (datos opcionales más detallados).
- Sin app asociada: se descarta por la complejidad que agrega.

## Infraestructura
- GitHub Pages para la página (solo archivos estáticos).
- **Base: Neon** (plan gratuito), desde el 2026-11-22. Antes se había diseñado sobre Supabase, pero el cupo de 2 proyectos gratuitos ya estaba ocupado. Neon da 100 proyectos con 1 GB cada uno, trae PostGIS y su Data API es compatible con PostgREST, así que el modelo de seguridad se mantuvo casi igual.

## Seguridad (toda dentro de la base, sin servidor)
- El rol `anonymous` de la Data API solo puede insertar reportes: no puede leer la tabla, ni editarla, ni borrarla, ni cambiar el estado.
- La página no lleva ninguna clave.
- Reglas en la base que validan los datos, más un tope de reportes por hora.
- Las fotos se achican en el navegador, lo que borra la ubicación que trae el archivo.
- PostGIS va en el esquema `gis` para que la Data API no exponga sus funciones.
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

## Puntos a resolver
- GitHub Pages desde un repositorio privado requiere un plan pago (Pro o Team). Con cuenta gratuita, el repositorio tiene que ser público. No hay riesgo: la página no lleva claves y la protección la dan los permisos de la base.
- Tope por hora sin cuentas: un tope global en la base es simple y seguro. Un tope por IP es fácil de eludir; para eso sirve Turnstile.
- La tarea programada de GitHub Actions para el respaldo CSV sigue pendiente.
