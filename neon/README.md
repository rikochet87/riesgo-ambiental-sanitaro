# Base de datos en Neon

Estado: **creada y probada el 2026-11-22**.

| | |
|---|---|
| Proyecto | `riesgo-ambiental-sanitaro` (`falling-dream-07959218`) |
| Rama | `production` (`br-calm-sun-b6l0152k`) |
| Base | `neondb` |
| Región | São Paulo (`aws-sa-east-1`) |
| PostgreSQL | 18, con PostGIS en el esquema `gis` |
| Quién se conecta | solo las funciones de `/api` en Vercel, con `DATABASE_URL` |

La página no habla con la base. Las funciones de `/api` se conectan con la
cadena de `DATABASE_URL` (cargada en Vercel) y, antes de cada consulta, hacen
`set local role anonymous`: trabajan con los permisos del público. Ahí sigue
estando toda la seguridad.

La Data API y Neon Auth de la primera versión se **apagaron el 2026-11-22**
(la Data API exigía un JWT hasta para el acceso anónimo, y Neon Auth, que lo
emitía, no respondió; ver `docs/01_decisiones.md`). Con eso la base no tiene
ninguna entrada pública: solo se llega con la cadena de conexión. Queda el
esquema `auth` que creó la Data API: solo tiene funciones auxiliares, sin datos.

## Orden de ejecución

1. `schema.sql` (crea el rol `anonymous` si falta)
2. `riesgo.sql`
3. `moderacion.sql` (rol `moderador` del panel `/admin` y tope de intentos de entrada)

## Qué puede hacer el público

| Acción | Resultado |
|---|---|
| Insertar un reporte (solo las columnas del vecino) | permitido |
| Leer `reportes_publicos` | permitido |
| `foto_basural(id)` y `riesgo_basural(id)` | permitido |
| Leer, editar o borrar `reportes` | bloqueado |
| Leer la foto cruda o la descripción de otro | bloqueado |
| Insertar fijando `estado` o `foto_aprobada` | bloqueado |
| Insertar fuera del Gran Resistencia, o con un tipo inventado | bloqueado por las reglas |
| Leer las capas de contexto o los parámetros | bloqueado |

Probado el 2026-11-22 ejecutando cada caso con `set role anonymous`, y de nuevo a través de las funciones de `/api` (`npm test`).
La prueba de alta completa (insertar → verificar → ver en el mapa → traer la
foto → calcular el riesgo) también pasó; el reporte de prueba quedó borrado.

El riesgo de ese reporte dio 43 (medio) con las capas todavía vacías: amenaza
y reportes vecinales tenían datos, exposición y vulnerabilidad quedaron en
`null` y los pesos se repartieron entre los dos factores con datos, que es
justo lo que tiene que pasar mientras falten capas.

## Abuso

Lo frenan los topes del trigger: 200 reportes por hora en total y uno por
punto cada 10 minutos. La CSP de la página solo le permite hablar con su
propio dominio, pero eso frena navegadores, no programas: los topes son la
protección real.

## Moderar

```sql
-- pendientes, sin traer la foto
select id, creado_en, lat, lon, tipo, tamano, quema, descripcion,
       (foto is not null) as tiene_foto
from public.reportes where estado = 'pendiente' order by creado_en desc;

-- publicar (rojo en el mapa) y aprobar la foto
update public.reportes
set estado = 'verificado', foto_aprobada = true, revisado_en = now()
where id = '...';
```

Estados: `pendiente`, `verificado` (rojo), `en_gestion` (amarillo),
`resuelto` (verde), `descartado`. Solo los tres del medio salen en el mapa.

## Cosas del plan gratuito a tener en cuenta

- La base se duerme a los 5 minutos sin uso y despierta sola en el primer
  pedido: el primero del día tarda un segundo más.
- No hay copia de seguridad automática. Pendiente: respaldo semanal a CSV.
- 1 GB de base y 5 GB de tráfico por mes. Con fotos de 200 KB eso es del
  orden de 5000 reportes con foto.
