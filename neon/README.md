# Base de datos en Neon

Estado: **creada y probada el 2026-11-22**.

| | |
|---|---|
| Proyecto | `riesgo-ambiental-sanitaro` (`falling-dream-07959218`) |
| Rama | `production` (`br-calm-sun-b6l0152k`) |
| Base | `neondb` |
| Región | São Paulo (`aws-sa-east-1`) |
| PostgreSQL | 18, con PostGIS en el esquema `gis` |
| Data API | habilitada, rol anónimo `anonymous`, solo esquema `public` |
| URL REST | la que está en `config.js` |

La URL no lleva clave: quien la tenga puede hacer **solo** lo que el rol
`anonymous` tiene permitido en la base. Ahí está toda la seguridad.

## Orden de ejecución

1. Data API habilitada en la rama (crea los roles `anonymous` y `authenticated`).
2. `schema.sql`
3. `riesgo.sql`

Después de cualquier cambio de estructura hay que refrescar la caché de la
Data API (en la consola, *Refresh schema cache*), o no aparece lo nuevo.

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

Probado el 2026-11-22 ejecutando cada caso con `set role anonymous`.
La prueba de alta completa (insertar → verificar → ver en el mapa → traer la
foto → calcular el riesgo) también pasó; el reporte de prueba quedó borrado.

El riesgo de ese reporte dio 43 (medio) con las capas todavía vacías: amenaza
y reportes vecinales tenían datos, exposición y vulnerabilidad quedaron en
`null` y los pesos se repartieron entre los dos factores con datos, que es
justo lo que tiene que pasar mientras falten capas.

## Desde qué sitios se puede llamar (CORS)

Configurado para `https://rikochet87.github.io` y `localhost:8000`. Si la
página se publica en otro dominio, hay que agregarlo. Esto no es una
protección real (un programa puede llamar igual, sin navegador); lo que frena
el abuso son los topes del trigger: 200 reportes por hora y un reporte por
punto cada 10 minutos.

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
