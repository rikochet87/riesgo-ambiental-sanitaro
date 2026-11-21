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
- Proyecto propio de Supabase en el plan gratuito, separado del de SIG Vial. Con este quedan ocupados los 2 proyectos gratuitos.

## Seguridad (toda dentro de Supabase, sin servidor)
- La seguridad por filas (RLS) deja al público solo cargar reportes: no puede leer los de otros, ni editarlos, ni borrarlos.
- Reglas en la base que validan los datos, más un tope de reportes por hora.
- Las fotos se achican en el navegador, lo que borra la ubicación que trae el archivo. La carpeta de fotos permite subir pero nunca listar.
- Opcional: una función de Supabase con captcha (Cloudflare Turnstile) que revise el reporte y vuelva a limpiar la foto.

## Privacidad
- Las fotos no se publican hasta que alguien las revisa.
- Nunca se muestra quién reportó.

## Límites del plan gratuito
- Base de datos: 500 MB.
- Fotos: 1 GB, unas 5000 de 200 KB.
- Tráfico: 5 GB por mes. Conviene mostrar la foto solo al tocar un reporte.

## Riesgos
- Supabase pausa el proyecto tras 7 días sin uso.
- No hay copias de seguridad automáticas: hace falta una exportación periódica (por ejemplo, un CSV con una tarea programada de GitHub Actions).

## Para reusar
Las secciones de fauna y del semáforo de SIG Vial ya tienen resueltos la cola sin señal, los topes, la limpieza de fotos y la moderación.

## Puntos a resolver
- GitHub Pages desde un repositorio privado requiere un plan pago (Pro o Team). Con cuenta gratuita, el repositorio tiene que ser público. La clave anónima de Supabase puede ser pública: la protección la da RLS.
- Tope por hora sin cuentas: un tope global en la base es simple y seguro. Un tope por IP es fácil de eludir; para eso sirve Turnstile.
- La misma tarea programada de GitHub Actions puede hacer el respaldo CSV y, de paso, evitar la pausa por inactividad.
