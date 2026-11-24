/*
 * 09_quemas_ee.js — Quemas en los basurales reportados (Google Earth Engine)
 * ==========================================================================
 * Se pega en el editor de Earth Engine (code.earthengine.google.com), con el
 * proyecto "chaco" elegido arriba a la derecha.
 *
 * Qué hace
 * --------
 * Cuenta cuántas veces se quemó cada basural reportado en los últimos 12
 * meses, con imágenes Sentinel-2 (una pasada cada 5 días). Para eso:
 *   1. Toma las imágenes del área y saca nubes y sombras (Cloud Score+) y el
 *      agua (una laguna y la ceniza se confunden en el infrarrojo).
 *   2. Calcula el índice de área quemada NBR = (B8A − B12) / (B8A + B12).
 *      Una quema lo hace caer de golpe: la vegetación y los residuos secos
 *      reflejan el infrarrojo cercano; la ceniza y el carbón, no.
 *   3. Para cada fecha, compara cada píxel con la mediana de los 45 días
 *      anteriores (dNBR = antes − ahora). Píxel quemado: dNBR > 0,25 y
 *      NBR < 0,05.
 *   4. Alrededor de cada reporte (círculo de 60 m, por el error del GPS del
 *      celular) cuenta los píxeles quemados de cada fecha. Hay detección si
 *      suman al menos lo que ocupa un píxel de 20 m.
 *   5. Detecciones a menos de 20 días entre sí son la misma quema.
 * Resultado por reporte: quemas_12m, la cantidad de fechas con cielo
 * despejado sobre el punto (observaciones) y las fechas de cada quema.
 *
 * Límites
 * -------
 * - B12 tiene 20 m por píxel: una quema de pocos metros puede no verse. Por
 *   eso, en el índice, las quemas del satélite se combinan con lo que informó
 *   el vecino y queda la señal más alta; el satélite nunca borra una quema
 *   informada.
 * - Con pocas observaciones despejadas (menos de 15 en el año) el dato no se
 *   carga: un "0" ahí no significaría nada.
 * - Umbrales tomados de la literatura de áreas quemadas, sin calibrar todavía
 *   con basurales conocidos del Gran Resistencia.
 *
 * Antes de correrlo
 * -----------------
 * 1. Subí reportes_ee.csv (te lo paso yo; tiene id, latitude, longitude) en
 *    Assets > New > CSV file (.csv). Tiene ubicaciones privadas de los
 *    reportes: el recurso queda privado en tu proyecto, no lo compartas.
 * 2. Copiá la ruta del recurso (Assets, clic en el recurso, "Table ID") en
 *    PUNTOS, acá abajo.
 * 3. Run. En Tasks aparece "quemas_basurales": tocá Run y exporta un CSV a
 *    tu Google Drive (carpeta EarthEngine). Ese CSV me lo pasás.
 */

// ------------------------------------------------------------------ Ajustes
var PUNTOS = 'projects/chaco/assets/reportes_ee';   // ← la ruta de tu recurso
var RADIO_M = 60;              // círculo alrededor de cada reporte
var DIAS_ANTES = 45;           // ventana para la referencia "antes"
var UMBRAL_DNBR = 0.25;        // caída del NBR que cuenta como quema
var UMBRAL_NBR = 0.05;         // NBR después de la quema (ceniza)
var MIN_PIXELES = 4;           // píxeles de 10 m quemados (= un píxel de 20 m)
var DIAS_MISMA_QUEMA = 20;     // detecciones más juntas son la misma quema
var MIN_OBSERVACIONES = 15;    // fechas despejadas mínimas para dar el dato
var NUBES_CS = 0.65;           // Cloud Score+: 1 = despejado

// ------------------------------------------------------------------ Datos
var fin = ee.Date(Date.now());
var inicio = fin.advance(-12, 'month');
var puntos = ee.FeatureCollection(PUNTOS);
var circulos = puntos.map(function (p) { return p.buffer(RADIO_M); });
var region = circulos.geometry().bounds().buffer(500);

var csPlus = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

var imagenes = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(region)
  .filterDate(inicio.advance(-DIAS_ANTES, 'day'), fin)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 70))
  .linkCollection(csPlus, ['cs_cdf'])
  .map(function (img) {
    var scl = img.select('SCL');
    // 3 sombra de nube, 6 agua, 8-10 nubes y cirros
    var util = scl.neq(3).and(scl.neq(6)).and(scl.lt(8).or(scl.gt(10)));
    var despejado = img.select('cs_cdf').gte(NUBES_CS).and(util);
    var nbr = img.normalizedDifference(['B8A', 'B12']).rename('nbr');
    return nbr.updateMask(despejado)
      .copyProperties(img, ['system:time_start']);
  });

// Un mosaico por día (las teselas de una misma pasada se juntan)
var dias = ee.List(imagenes.aggregate_array('system:time_start'))
  .map(function (t) { return ee.Date(t).format('YYYY-MM-dd'); })
  .distinct();

var mosaicos = ee.ImageCollection.fromImages(dias.map(function (d) {
  var dia = ee.Date.parse('YYYY-MM-dd', d);
  return imagenes.filterDate(dia, dia.advance(1, 'day')).mosaic()
    .set('system:time_start', dia.millis());
}));

// ------------------------------------------------------------------ Quemas por fecha
var porFecha = mosaicos
  .filterDate(inicio, fin)
  .map(function (img) {
    var t = ee.Date(img.get('system:time_start'));
    var antes = mosaicos.filterDate(t.advance(-DIAS_ANTES, 'day'), t).median();
    var nbr = img.select('nbr');
    var dnbr = antes.select('nbr').subtract(nbr);
    var quema = dnbr.gt(UMBRAL_DNBR).and(nbr.lt(UMBRAL_NBR))
      .updateMask(nbr.mask().and(antes.select('nbr').mask()))
      .rename('quema');
    return quema.reduceRegions({
      collection: circulos,
      reducer: ee.Reducer.sum().combine(ee.Reducer.count(), '', true),
      scale: 10
    }).map(function (f) { return f.set('fecha', t.millis()); });
  })
  .flatten();

// ------------------------------------------------------------------ Resumen por reporte
var DIA_MS = 24 * 60 * 60 * 1000;

var resultado = puntos.map(function (p) {
  var filas = porFecha.filter(ee.Filter.eq('id', p.get('id')));
  var observaciones = filas.filter(ee.Filter.gt('count', 0)).size();
  var detecciones = ee.List(filas.filter(ee.Filter.gte('sum', MIN_PIXELES))
    .aggregate_array('fecha')).sort();

  var cuenta = ee.Dictionary(detecciones.iterate(function (t, acc) {
    acc = ee.Dictionary(acc);
    t = ee.Number(t);
    var nueva = t.subtract(ee.Number(acc.get('ultima'))).gt(DIAS_MISMA_QUEMA * DIA_MS);
    return ee.Dictionary({
      quemas: ee.Number(acc.get('quemas')).add(nueva),
      ultima: t,
      fechas: ee.Algorithms.If(nueva,
        ee.List(acc.get('fechas')).add(ee.Date(t).format('YYYY-MM-dd')),
        acc.get('fechas'))
    });
  }, { quemas: 0, ultima: -1e15, fechas: [] }));

  var suficiente = observaciones.gte(MIN_OBSERVACIONES);
  return ee.Feature(null, {
    id: p.get('id'),
    quemas_12m: ee.Algorithms.If(suficiente, cuenta.get('quemas'), null),
    observaciones: observaciones,
    fechas: ee.List(cuenta.get('fechas')).join(' '),
    desde: inicio.format('YYYY-MM-dd'),
    hasta: fin.format('YYYY-MM-dd')
  });
});

// ------------------------------------------------------------------ Salida
print('Reportes:', puntos.size());
print('Días con imagen en el período:', mosaicos.filterDate(inicio, fin).size());
print('Primeros resultados:', resultado.limit(10));

Map.centerObject(region, 13);
Map.addLayer(circulos, { color: 'red' }, 'Reportes (círculo de ' + RADIO_M + ' m)');

Export.table.toDrive({
  collection: resultado,
  description: 'quemas_basurales',
  fileFormat: 'CSV',
  selectors: ['id', 'quemas_12m', 'observaciones', 'fechas', 'desde', 'hasta']
});
