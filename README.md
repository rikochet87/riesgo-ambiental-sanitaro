# Basurales en el Gran Resistencia

Página web para que los vecinos del Gran Resistencia (Chaco, Argentina) denuncien basurales a cielo abierto desde el celular, sin crear una cuenta. Cada basural revisado aparece en un mapa público con un **índice de riesgo ambiental y sanitario** que combina lo que cuenta el vecino con datos censales, cartográficos y satelitales.

- Página: https://riesgo-ambiental-sanitaro.vercel.app
- Panel de moderación: https://riesgo-ambiental-sanitaro.vercel.app/admin

Es un proyecto personal e independiente, sin fines comerciales. Funciona con servicios en plan gratuito: Vercel (página y funciones) y Neon (PostgreSQL + PostGIS).

## Por qué

Un basural a cielo abierto no es solo un problema de limpieza. La literatura lo vincula con riesgos para la salud de quienes viven cerca:

- **Cercanía.** Una revisión sistemática reunió 29 estudios sobre los efectos en la salud de vivir cerca de rellenos, incineradores y basurales con quema a cielo abierto, entre ellos mortalidad, resultados adversos del embarazo y del recién nacido, cáncer y enfermedades respiratorias (Vinti et al., 2021).
- **Quemas.** Quemar residuos, en especial plásticos, libera contaminantes persistentes y sustancias cancerígenas. Es la forma en que se autogestionan la basura unos 2000 millones de personas sin recolección (Velis y Cook, 2021). Se estima que el material particulado fino (PM2.5) de la quema de residuos domiciliarios causa unas 270.000 muertes prematuras de adultos por año en el mundo (Kodros et al., 2016).
- **Vectores.** Los residuos acumulan agua y sirven de criadero a *Aedes aegypti*, el mosquito del dengue, el zika y la chikunguña, además de dar refugio y alimento a roedores (Krystosik et al., 2020; Banerjee et al., 2013). En el Gran Resistencia, con clima cálido y lluvioso, esto pesa especialmente.
- **Agua.** Los líquidos que escurren de la basura (lixiviados) contaminan el suelo y el agua. Resistencia tiene decenas de lagunas urbanas, riachos y canales a cielo abierto.

Saber **dónde** están los basurales y **cuáles** son más riesgosos ayuda a priorizar: qué limpiar primero, dónde controlar quemas, dónde reforzar la prevención del dengue. Ese es el propósito del mapa y del índice.

## Cómo funciona

1. **El vecino reporta.** Marca el punto en el mapa, saca una foto (opcional) y, si quiere, completa un relevamiento corto: tipo de residuos, tamaño, si se quema, desde cuándo está. Funciona sin señal: el reporte queda guardado y se envía solo al recuperarla.
2. **Un moderador revisa.** Desde el panel `/admin` publica o descarta cada reporte, decide si la foto se muestra y puede quitarla (caras, patentes), corrige el tamaño mirando la foto, marca "ya no está" cuando un basural desaparece o elimina el reporte entero.
3. **El mapa público** muestra los basurales activos ya revisados. El **color** es su riesgo (rojo alto, amarillo medio, verde bajo) y el **tamaño del punto**, el tamaño del basural; con borde punteado, si no se informó. Al tocar uno se ve la foto aprobada y el índice de riesgo con sus componentes. Cuando un basural desaparece, el moderador lo marca "ya no está" y deja de verse.

**Privacidad.** Nunca se muestra quién reportó. Las fotos pierden en el celular la ubicación que traen y no se publican hasta que alguien las revisa. El público solo puede *cargar* reportes: no puede leer los ajenos, ni editarlos, ni borrarlos. El mapa público redondea las coordenadas a unos 11 m.

## El índice de riesgo

### Para qué sirve, y para qué no

El índice ordena los basurales por **prioridad de atención**: un número de 0 a 100 y una clase (bajo, medio, alto) que resumen cuánto daño puede hacer ese basural, a cuánta gente y en qué entorno. No es un diagnóstico sanitario ni mide la contaminación real de un lugar: es un indicador para comparar basurales entre sí y decidir por dónde empezar.

Es **preliminar**: los pesos y umbrales salen de la literatura y de criterio propio, y todavía no están calibrados con basurales conocidos del Gran Resistencia. El popup lo aclara.

### De dónde sale el esquema

Sigue el marco clásico del riesgo de desastres (IPCC, UNDRR): el **riesgo** surge de combinar una **amenaza** (el peligro), la **exposición** (qué y quiénes están cerca) y la **vulnerabilidad** (qué tan sensible es el entorno). A esos tres se suma un cuarto componente propio del proyecto, los **reportes vecinales**, que capta persistencia y concentración.

La idea de un indicador SIG de riesgo por residuos que combine tipo de sitio, quema y población cercana se apoya en trabajos como el *Municipal Risk Index* de la llamada "Tierra de los Fuegos" en Campania, Italia (Fazzo et al., 2020). Allí se contó la población a 100 m de cada sitio y casi el 90 % de los sitios eran basurales ilegales o con quema. La selección de variables y los pesos de este índice son propios y deben ajustarse con un método de ponderación como AHP (proceso analítico jerárquico) y con casos locales.

### Por qué cada componente

| Componente | Qué mide | Por qué importa |
| --- | --- | --- |
| **Amenaza** | Tamaño, frecuencia de quemas y persistencia del basural | Más residuos, más tiempo y más quemas implican más humo tóxico, más lixiviados y más criaderos (Velis y Cook, 2021; Kodros et al., 2016) |
| **Exposición** | Población, escuelas y centros de salud a menos de 300 m | Los efectos en la salud se asocian a la cercanía residencial (Vinti et al., 2021; Fazzo et al., 2020). Escuelas y centros de salud concentran población sensible: chicos, pacientes |
| **Vulnerabilidad ambiental** | Distancia a lagunas, ríos, riachos y canales; zona inundable | El agua cercana recibe lixiviados y los distribuye; en zonas bajas el agua estancada favorece criaderos de *Aedes* (Krystosik et al., 2020) |
| **Reportes vecinales** | Basurales activos cerca y antigüedad del más viejo | Un basural que persiste y tiene otros alrededor indica un problema estructural de la zona, no un episodio |

### Cómo se calcula

Todo el cálculo vive en la base de datos (función `riesgo_calculo` en `neon/riesgo.sql`), así que es el mismo para el mapa público y para el panel. Cada componente da un valor de 0 a 1; los parámetros están en la tabla `parametros_riesgo` y se pueden cambiar sin tocar código.

**1. Amenaza** = promedio de tres valores:

| Valor | Con lo que releva el vecino | Con el satélite (si hay dato) |
| --- | --- | --- |
| Tamaño | bolsas 0,1 · carretilla 0,3 · camioneta 0,6 · camión o más 1 (corregido por el moderador mirando la foto, si lo hizo) | superficie / 5000 m² (tope 1) |
| Quemas | se quema: 1 · no: 0 | quemas en 12 meses / 4 (tope 1) |
| Persistencia | días 0,2 · semanas 0,4 · meses 0,7 · más de un año 1 | crecimiento de la superficie en el año / 100 % (entre 0 y 1) |

Cada dato satelital completa su parte por separado: la superficie y el crecimiento, si están, reemplazan lo del vecino. Las quemas se combinan y queda la señal más alta, porque a 20 m por píxel al satélite se le escapan las quemas chicas: **el satélite nunca borra una quema que informó un vecino**. El popup indica si la amenaza salió del relevamiento, del satélite o de los dos ("mixta"). Hoy el satélite solo mide quemas (ver "Datos satelitales").

**2. Exposición** = promedio ponderado:
- 50 %: población a menos de 300 m / 2000 personas (tope 1). Cada radio censal aporta su población en proporción al área que cae dentro del círculo de 300 m.
- 25 %: escuelas a menos de 300 m / 2 (tope 1). Las escuelas a menos de 50 m entre sí cuentan como un solo edificio, para no contar dos veces los turnos o niveles que comparten el mismo lugar.
- 25 %: centros de salud a menos de 300 m / 1 (tope 1).

**3. Vulnerabilidad ambiental** = promedio ponderado:
- 60 %: cercanía al agua. Vale 1 si hay agua a 50 m o menos, baja en línea recta hasta 0 a los 500 m, y es 0 más allá.
- 40 %: zona inundable (1 adentro, 0 afuera). **Hoy sin dato**: no se consiguió la cartografía oficial, así que este factor queda afuera y la vulnerabilidad sale solo del agua.

**4. Reportes vecinales** = 50 % basurales activos (verificados) a menos de 300 m, contando este, / 5 (tope 1) + 50 % días desde el reporte activo más viejo de la zona / 180 (tope 1).

**Total** = 100 × promedio ponderado de los cuatro componentes, con pesos iniciales de 25 % cada uno. **Clases:** bajo por debajo de 34, medio de 34 a 66, alto desde 67.

**Índice guardado.** Para pintar el mapa por riesgo, la base guarda el último índice de cada basural activo (`riesgo_cache`). Calcularlo tarda unos 25 ms por basural, así que no se hace en cada visita: se recalcula al moderar (ese basural y los activos a menos de 300 m, porque el componente de reportes depende de los vecinos), al cargar capas o datos satelitales (todos, con `riesgo_recalcular_todo()`), y en cada visita al mapa se refrescan hasta 20 índices de más de un día, para que la persistencia avance. El popup siempre calcula el índice en el momento.

**Datos faltantes.** Si una capa no está cargada, ese factor figura como "sin datos" y su peso se reparte entre los que sí tienen dato. No se inventan valores. Eso tiene una consecuencia: al cargar una capa nueva, un factor que antes no contaba entra con su valor real, y si es bajo, el índice de un basural puede bajar.

### Un ejemplo con un reporte real

Un basural junto al canal de la Av. Soberanía Nacional, que el vecino describió como de tamaño camioneta, con quemas, y de hace días:

| Componente | Cálculo | Valor |
| --- | --- | --- |
| Amenaza | promedio de tamaño 0,6, quemas 1 (el satélite detectó 2 en el año y el vecino informó quema) y persistencia 0,2 | 0,60 |
| Exposición | 0,5 × (~1243 personas / 2000) + 0,25 × (0 escuelas / 2) + 0,25 × (1 centro de salud / 1) | 0,56 |
| Vulnerabilidad | canal a 19 m, menos de 50 m (sin dato de zona inundable) | 1,00 |
| Reportes | 0,5 × (1 activo / 5) + 0,5 × (pocos días / 180) | 0,10 |
| **Total** | 100 × (0,60 + 0,56 + 1,00 + 0,10) / 4 | **57, medio** |

### De dónde salen los datos

| Capa | Contenido | Fuente | Cómo se preparó |
| --- | --- | --- | --- |
| `capa_poblacion` | 565 radios censales con 427.809 personas | Población: INDEC, Censo Nacional de Población, Hogares y Viviendas 2022, base REDATAM (personas en viviendas particulares). Geometría: base de radios censales 2022 revisada para SIG (Rodriguez, CONICET) | `scripts/01_recorte_radios.py` y `scripts/08_poblacion_radios.py` |
| `capa_escuelas` | 357 sitios (494 establecimientos agrupados a 50 m) | Mapa Educativo Nacional | `scripts/03_recorte_educacion.py` y `scripts/05_sitios_escuelas.py` |
| `capa_salud` | 42 establecimientos | Capas SIG del Instituto Geográfico Nacional (IGN) | `scripts/02_recorte_salud.py` |
| `capa_agua` | 818 lagunas, ríos, riachos, canales y desagües | IGN (aguas continentales), IDE Chaco (lagunas de las cuencas urbanas) y OpenStreetMap | `scripts/04_recorte_hidrografia.py` y `scripts/07_agua_osm.py`: se suman en ese orden y se descarta lo que ya está cubierto en un 80 %, así que en las lagunas urbanas manda el contorno oficial de la IDE |
| `capa_inundable` | vacía | APA Chaco (Res. 1111/98 y 303/17): cartografía no disponible | — |
| `amenaza_satelital` | quemas en 12 meses por reporte | Sentinel-2 (Copernicus) en Google Earth Engine | `scripts/09_quemas_ee.js` |

El procedimiento de cada script, con fechas y resultados, está en `scripts/README.md`. `scripts/06_sql_capas.py` arma el SQL de carga (`neon/capas_contexto.sql`, y uno por capa en `neon/capas/`).

*Fuente de la población: elaboración propia con base en datos del INDEC, Censo Nacional de Población, Hogares y Viviendas 2022, procesado con Redatam. Datos de OpenStreetMap © colaboradores de OpenStreetMap, licencia ODbL.*

### Datos satelitales

`scripts/09_quemas_ee.js` corre en Google Earth Engine y cuenta las quemas de los últimos 12 meses alrededor de cada reporte con imágenes Sentinel-2, que pasan cada 5 días:

1. Saca nubes y sombras con Cloud Score+ (Pasquarella et al., 2023), y también el agua, que en el infrarrojo se confunde con la ceniza.
2. Calcula el índice de área quemada NBR = (B8A − B12) / (B8A + B12) (Key y Benson, 2006). Una quema lo hace caer de golpe: la vegetación y los residuos secos reflejan el infrarrojo cercano, y la ceniza y el carbón no.
3. Compara cada fecha con la mediana de los 45 días anteriores (dNBR). Un píxel cuenta como quemado si el dNBR supera 0,25 y el NBR queda por debajo de 0,05.
4. Hay una quema si, en un círculo de 60 m alrededor del reporte (por el error del GPS del celular), los píxeles quemados ocupan al menos lo que un píxel de 20 m. Las detecciones a menos de 20 días entre sí cuentan como la misma quema.
5. Si hubo menos de 15 fechas despejadas en el año, no se informa dato, porque un "0" no diría nada.

**Límite:** muchos basurales son más chicos que un píxel de 20 m, y sus quemas pueden no verse. Por eso el satélite suma evidencia pero no reemplaza al vecino en las quemas. La superficie y el crecimiento satelitales quedan para más adelante: detectar basurales con imágenes requiere entrenar un modelo con ejemplos conocidos, como se hizo en la Provincia de Buenos Aires con Sentinel-2 (Devesa y Vazquez Brust, 2021). Los basurales que se confirmen en el panel van a servir para eso.

### Limitaciones

- Pesos y umbrales sin calibrar localmente (ver "Pendiente").
- Sin zonas inundables.
- La población es la de 2022 y solo cuenta personas en viviendas particulares.
- La hidrografía de OpenStreetMap depende de lo que cargaron sus voluntarios.
- El índice de un basural depende de que el vecino haya completado el relevamiento: sin datos de tamaño o persistencia, la amenaza se calcula con lo que haya.

## Uso y mantenimiento

### Archivos

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
| `neon/riesgo.sql` | Índice de riesgo, capas de contexto e índice guardado (`riesgo_cache`) |
| `neon/moderacion.sql` | Rol `moderador`, tope de intentos de entrada y registro de copias de seguridad |
| `admin.html`, `admin.js`, `admin.css` | Panel de moderación (`/admin`) |
| `admin-zip.js` | Arma el ZIP de la copia de seguridad en el navegador |
| `indice.js` | Bloque del índice de riesgo, compartido por el popup público y el del panel |
| `scripts/` | Preparación de las capas de contexto y script de Earth Engine (ver `scripts/README.md`) |
| `datos/` | Capas de contexto ya recortadas al Gran Resistencia (datos públicos) |
| `neon/capas_contexto.sql`, `neon/capas/` | Carga de las capas de contexto (generado por `scripts/06_sql_capas.py`) |
| `docs/` | Decisiones, modelo de datos, índice, fuentes y bibliografía |

### Puesta en marcha

1. **Neon:** creá un proyecto. En el *SQL Editor* pegá y ejecutá, en este orden, `neon/schema.sql`, `neon/riesgo.sql`, `neon/moderacion.sql` y `neon/capas_contexto.sql` (las capas del índice). Los roles `anonymous` y `moderador` se crean solos si faltan.
2. **Vercel:** importá el repositorio (*Add New > Project*). No lleva comando de build: Vercel publica los archivos y arma las funciones de `api/`.
3. **Conexión:** en Neon, *Connect* → copiá la cadena de conexión (`postgresql://...`). En Vercel, *Settings > Environment Variables*, creá `DATABASE_URL` con ese valor. Esa cadena lleva la contraseña: va solo ahí, nunca al repositorio ni a la página.
4. **Clave del panel:** en el mismo lugar creá `ADMIN_CLAVE`, de al menos 12 caracteres (mejor una frase larga). Volvé a desplegar para que tome las dos variables.
5. Abrí la URL de Vercel desde el celular y probá un reporte.

Cada `git push` a `main` vuelve a desplegar solo.

#### Probar en tu computadora

Con un PostgreSQL + PostGIS local y una base `prueba_api` con los dos `.sql` cargados:

- `npm test`: prueba las funciones de `/api` y `/api/admin`, incluidos los intentos de abuso.
- `npm run local`: sirve la página y `/api` en `http://localhost:8000`, con las mismas cabeceras que Vercel.

### Cómo funciona la seguridad

- La página **no lleva ninguna clave** y nunca habla con la base: habla con las funciones de `/api`, en el mismo dominio. La contraseña de la base vive solo en Vercel.
- Cada función abre una transacción y lo primero que hace es `set local role anonymous`: trabaja con los permisos del público. Ese rol **solo puede insertar** reportes, con las columnas del vecino; no puede leer la tabla, ni editarla, ni borrarla, ni cambiar el estado. Si algún día una función tuviera un error, la base igual la frenaría.
- La lista de columnas que acepta el alta es fija: cualquier otra clave del JSON (`estado`, `foto_aprobada`...) se descarta.
- La página solo puede conectarse con su propio dominio (`connect-src 'self'` en la CSP de `vercel.json`).
- Reglas en la base: punto dentro del Gran Resistencia, valores válidos en las listas, comentario de hasta 500 caracteres, foto de hasta 400 KB.
- **Topes:** 200 reportes por hora en total y rechazo de reportes a menos de 20 m de otro de los últimos 10 minutos. Desde la misma conexión: 10 reportes por hora, 30 por día y 3 MB de fotos por hora. Entre todos: 150 MB de fotos por día. Todo se ajusta en `reportes_control_insercion`.
- **Origen sin IP:** para los topes por conexión, la función manda a la base un código diario: un HMAC de la IP con una llave secreta y la fecha. No se puede volver a la IP, cambia cada día, no se guarda junto al reporte y se borra a las 24 horas (tabla `limite_origen`, que nadie más que el dueño de la base puede leer). La IP la escribe Vercel y no se puede falsificar; en IPv6 se cuenta por prefijo /64. Varios celulares pueden compartir IP (CGNAT de las compañías móviles), así que los topes son holgados.
- **Fotos:** el navegador las achica a 1000 px y unos 200 KB, y al redibujarlas se pierden los metadatos, incluida la ubicación GPS. Viajan dentro del reporte y se guardan en la misma tabla. El público nunca lee esa columna: la foto se sirve de a una, ya aprobada, con la función `foto_basural()`.
- **Mapa público:** lee solo la vista `reportes_publicos`, con los basurales activos ya revisados, su clase de riesgo, coordenadas redondeadas (~11 m) y sin comentario ni foto. Los marcados "ya no está" no figuran. La tabla del índice guardado no la puede leer: solo la vista.
- **PostGIS** vive en el esquema `gis`, no en `public`, separado de las tablas del proyecto.
- **Bots:** campo trampa invisible; si se completa, no se envía nada.

### Moderar

Desde **`/admin`** (https://riesgo-ambiental-sanitaro.vercel.app/admin), con la clave `ADMIN_CLAVE`. Es un visor GIS:

- **Mapa con todos los reportes** en sus coordenadas exactas (el mapa público las redondea). Los pendientes, en azul índigo, se dibujan más grandes y por encima; los activos, como en el mapa público, con el color de su riesgo y el tamaño del basural. Mapa base de calles o satélite.
- **Capas por estado** que se prenden y apagan: pendientes, activos, "ya no están" y descartados (estos dos, apagados al abrir). La lista sigue a las capas prendidas.
- **Tocar un punto** (o una fila de la lista) abre el **popup con el índice de riesgo**, el mismo que ve el público, pero también para pendientes y descartados, que sirve para priorizar qué revisar primero. En la compu se abre además la ficha en el panel; en el celular el popup trae un botón "Moderar este reporte" que lleva a la ficha.
- **La ficha** muestra la foto aunque no esté aprobada, los datos del relevamiento, la descripción, un enlace a Google Maps y los botones de moderar. El punto queda marcado con un anillo. `Esc` vuelve a la lista.
- **Publicar** pasa un pendiente a activo, con o sin su foto. **Descartar** lo saca del circuito sin borrarlo. En los ya revisados se cambia el estado (activo o **ya no está**, que deja de verse en el mapa pero queda guardado) y se publica o despublica la foto.
- **Estados (desde 2026-11-24):** pendiente, activo, ya no está y descartado. "En gestión" y "resuelto" como seguimiento se dejaron de usar: el sistema no hace la gestión de los basurales. En la base, "ya no está" es el valor `resuelto`, y un `en_gestion` viejo cuenta como activo.
- **Quitar la foto** la borra de la base (para una cara, una patente o algo ofensivo). Pide un segundo toque porque no tiene vuelta atrás.
- **Tamaño según la foto:** el moderador puede corregir el tamaño que indicó el vecino. La corrección se guarda aparte (lo del vecino no se toca) y la usan el índice y el mapa; el popup avisa "Tamaño revisado con la foto". Elegir "Como dijo el vecino" la quita.
- Nota interna por reporte, que nunca se publica.
- **Eliminar reporte** lo borra entero de la base (foto, ubicación y datos). Pide confirmación con "Cancelar" seleccionado de entrada, sugiere Descartar si solo se quiere sacarlo del mapa, y avisa si no hay una copia de seguridad reciente. No tiene vuelta atrás salvo esa copia, o dentro de las 6 horas que guarda Neon.
- En la compu, el panel va a la izquierda y el mapa a la derecha. En el celular, el mapa ocupa la pantalla y el panel es una hoja que sube desde abajo: baja (resumen y capas), media (ficha con el punto a la vista) o alta (lista).

Lo publicado puede tardar un par de minutos en verse en el mapa: la CDN de Vercel guarda la lista unos minutos.

#### Copia de seguridad

El botón **Descargar copia de seguridad** del panel baja un ZIP a la compu con:

- `reportes.geojson`: todos los reportes con todos sus datos y las coordenadas completas. Se abre en QGIS y es la fuente para restaurar.
- `reportes.csv`: lo mismo para Excel (punto y coma, coma decimal, fechas en hora de Argentina). Los textos del vecino que empiezan con `=`, `+`, `-` o `@` llevan un apóstrofo adelante para que Excel no los ejecute como fórmula.
- `fotos/<id>.jpg`: todas las fotos, aprobadas o no.
- `LEEME.txt`: qué es cada cosa y cómo restaurar.

El ZIP se arma en el navegador porque Vercel no deja que una función devuelva más de 4,5 MB. Con muchas fotos, conviene hacerla desde la compu. El panel avisa en amarillo si pasa una semana sin copia.

**La copia es privada:** tiene fotos sin aprobar, descripciones y ubicaciones exactas, también de los descartados. Guardala en la compu o en Drive, nunca en el repositorio, que es público.

**Seguridad del panel:**
- La sesión es una cookie firmada, válida 8 horas, que solo viaja a `/api/admin`, no la puede leer JavaScript y no se manda desde otros sitios. Cambiar `ADMIN_CLAVE` cierra todas las sesiones.
- Con 10 claves incorrectas en 15 minutos **desde la misma conexión** se bloquea esa conexión (incluso con la correcta) hasta que pasen; desde otra se puede seguir entrando. Como respaldo, con 300 fallidos en 15 minutos entre todos se bloquea para todos.
- Las funciones del panel trabajan con el rol `moderador` de la base, que puede leer reportes, cambiar estado, foto y nota, corregir el tamaño (en una columna aparte) y eliminar un reporte entero, pero **no puede mover su ubicación ni editar lo que escribió el vecino**, aunque el código tuviera un error.
- Lo que escribe el vecino se muestra siempre como texto, nunca como HTML.

También se puede moderar desde el *SQL Editor* de Neon; hay consultas listas al final de `neon/schema.sql`.

### Sin señal

Si el envío falla por falta de conexión o por un error del servidor, el reporte (con su foto) queda guardado en el navegador y se reintenta solo al recuperar la señal o al volver a abrir la página. El id lo genera el celular, así que un reintento nunca duplica el reporte. Un rechazo de la base (datos inválidos, otro reporte en el mismo lugar, tope por hora) se le muestra al vecino y no se reintenta.

### Límites del plan gratuito de Neon

- 1 GB por proyecto. Las fotos comparten ese espacio: a 200 KB cada una entran unas 4000.
- 5 GB de tráfico de salida por mes. La foto solo se descarga al tocar un punto, y la CDN de Vercel guarda unos minutos la lista del mapa, las fotos y los índices, así que la mayoría de las visitas ni despiertan la base.
- 100 horas de cómputo por mes. La base se duerme tras 5 minutos sin uso y despierta sola en el primer pedido, así que no hay que reactivarla a mano.
- No hay copias de seguridad automáticas: Neon gratis solo vuelve atrás 6 horas. La copia se descarga desde el panel y depende de que alguien la haga; el panel avisa si pasa una semana. Las copias automáticas en GitHub se descartaron porque el repositorio es público y la copia tiene datos privados.

## Pendiente

- **Calibrar el índice:** ponderar los componentes con AHP y contrastar con basurales conocidos del Gran Resistencia.
- **Superficie y crecimiento satelitales,** entrenando la detección con los basurales confirmados.
- **Zonas inundables,** si se publica la cartografía. Una aproximación posible es la frecuencia de agua superficial del JRC (Global Surface Water) en Earth Engine.
- Captcha (Cloudflare Turnstile) si aparece spam.
- Si el proyecto crece, mover las fotos a un almacenamiento aparte y dejar en la base solo su dirección.

## Bibliografía

**Salud y residuos**

- Vinti, G., Bauza, V., Clasen, T., Medlicott, K., Tudor, T., Zurbrügg, C. y Vaccari, M. (2021). Municipal Solid Waste Management and Adverse Health Outcomes: A Systematic Review. *International Journal of Environmental Research and Public Health*, 18(8), 4331. https://doi.org/10.3390/ijerph18084331
- Velis, C. A. y Cook, E. (2021). Mismanagement of Plastic Waste through Open Burning with Emphasis on the Global South: A Systematic Review of Risks to Occupational and Public Health. *Environmental Science & Technology*, 55(11), 7186–7207. https://doi.org/10.1021/acs.est.0c08536
- Kodros, J. K., Wiedinmyer, C., Ford, B., Cucinotta, R., Gan, R., Magzamen, S. y Pierce, J. R. (2016). Global burden of mortalities due to chronic exposure to ambient PM2.5 from open combustion of domestic waste. *Environmental Research Letters*, 11(12), 124022. https://doi.org/10.1088/1748-9326/11/12/124022
- Krystosik, A., Njoroge, G., Odhiambo, L., Forsyth, J. E., Mutuku, F. y LaBeaud, A. D. (2020). Solid Wastes Provide Breeding Sites, Burrows, and Food for Biological Disease Vectors, and Urban Zoonotic Reservoirs: A Call to Action for Solutions-Based Research. *Frontiers in Public Health*, 7, 405. https://doi.org/10.3389/fpubh.2019.00405
- Banerjee, S., Aditya, G. y Saha, G. K. (2013). Household disposables as breeding habitats of dengue vectors: Linking wastes and public health. *Waste Management*, 33(1), 233–239. https://doi.org/10.1016/j.wasman.2012.09.013
- Organización Mundial de la Salud. *Open waste burning*. https://www.who.int/publications/i/item/B09367

**Índices de riesgo por residuos**

- Fazzo, L., De Santis, M., Beccaloni, E., Scaini, F., Iavarone, I., Comba, P. y Airoma, D. (2020). A Geographic Information System-Based Indicator of Waste Risk to Investigate the Health Impact of Landfills and Uncontrolled Dumping Sites. *International Journal of Environmental Research and Public Health*, 17(16), 5789. https://doi.org/10.3390/ijerph17165789
- Ocello, Majul et al. Riesgo a la salud en el AMBA (teledetección y mapeo participativo). Actas, CIM-FADU-UBA. https://www.publicacionescientificas.fadu.uba.ar/index.php/actas/article/download/2139/2317

**Teledetección**

- Key, C. H. y Benson, N. C. (2006). Landscape Assessment: Ground measure of severity, the Composite Burn Index; and Remote sensing of severity, the Normalized Burn Ratio. En D. C. Lutes et al., *FIREMON: Fire Effects Monitoring and Inventory System* (Gen. Tech. Rep. RMRS-GTR-164-CD, pp. LA 1–51). USDA Forest Service, Rocky Mountain Research Station.
- Pasquarella, V. J., Brown, C. F., Czerwinski, W. y Rucklidge, W. J. (2023). Comprehensive Quality Assessment of Optical Satellite Imagery Using Weakly Supervised Video Learning. En *Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR) Workshops*, pp. 2125–2135.
- Devesa, M. R. y Vazquez Brust, H. A. (2021). Mapping illegal waste dumping sites with neural-network classification of satellite imagery. arXiv:2110.08599. https://doi.org/10.48550/arXiv.2110.08599

**Datos**

- INDEC. Censo Nacional de Población, Hogares y Viviendas 2022. Base REDATAM de viviendas particulares. https://redatam.indec.gob.ar
- Rodriguez (CONICET, 2024). Base de radios censales 2022 revisada y corregida para SIG. https://ri.conicet.gov.ar/handle/11336/238198
- Instituto Geográfico Nacional. Capas SIG. https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/CapasSIG
- Mapa Educativo Nacional, capa de establecimientos educativos. https://mapa.educacion.gob.ar
- Infraestructura de Datos Espaciales del Chaco. Lagunas de las cuencas urbanas. http://idechaco.gob.ar
- OpenStreetMap, © colaboradores de OpenStreetMap, licencia ODbL. https://www.openstreetmap.org/copyright
- Copernicus Sentinel-2 (ESA), vía Google Earth Engine.

La recopilación ampliada, con notas por variable, está en `docs/05_bibliografia.md`.
