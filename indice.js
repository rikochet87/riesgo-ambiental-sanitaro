// Bloque del índice ambiental y sanitario. Lo usan el popup del mapa público
// (app.js) y el del panel de moderación (admin.js), para que digan lo mismo.

export const COLOR_CLASE = { bajo: '#2f9e44', medio: '#e8590c', alto: '#e03131' };

const fmt = (n) => Number(n).toLocaleString('es-AR');

// Los nombres de lugares vienen de las capas cargadas en la base: se escapan igual
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function barra(nombre, puntaje, peso, detalle) {
  const sinDatos = puntaje === null || puntaje === undefined;
  const pct = sinDatos ? 0 : Math.round(puntaje * 100);
  const color = sinDatos ? '#b8c4c6' : pct >= 67 ? '#e03131' : pct >= 34 ? '#f59f00' : '#2f9e44';
  return `
    <div class="rz-comp">
      <div class="rz-fila"><span>${nombre}</span><b>${sinDatos ? 'sin datos' : pct}</b></div>
      <div class="rz-barra"><i style="width:${pct}%;background:${color}"></i></div>
      <div class="rz-det">${detalle}${peso != null ? ` · peso ${Math.round(peso * 100)}%` : ''}</div>
    </div>`;
}

// riesgo: el JSON de riesgo_basural(), null mientras se calcula, o {error: true}
export function htmlIndice(riesgo) {
  if (!riesgo) return '<p class="rz-cargando">Calculando índice de riesgo…</p>';
  if (riesgo.error) return '<p class="rz-cargando">No se pudo calcular el índice ahora.</p>';

  const a = riesgo.amenaza, e = riesgo.exposicion, v = riesgo.vulnerabilidad, rv = riesgo.reportes, w = riesgo.pesos;

  const satelite = [a.area_m2 != null ? `${fmt(Math.round(a.area_m2))} m²` : null,
    a.quemas_12m != null ? `${a.quemas_12m} quema(s) detectada(s) en 12 meses` : null,
    a.crecimiento_pct != null ? `crece ${fmt(a.crecimiento_pct)}%/año` : null].filter(Boolean).join(', ');
  const detAmenaza = a.fuente === 'satelite' ? satelite + ' (satélite)'
    : a.fuente === 'mixta' ? `Relevamiento vecinal y satélite: ${satelite}`
    : 'Estimada con el relevamiento vecinal (aún sin análisis satelital)';
  const notaTamano = a.tamano_corregido ? ' Tamaño revisado con la foto.' : '';

  const detExpo = e.puntaje == null
    ? 'Faltan capas de población y equipamientos'
    : [e.poblacion != null ? `~${fmt(e.poblacion)} personas` : null,
       e.escuelas != null ? `${e.escuelas} escuela(s)` : null,
       e.salud != null ? `${e.salud} centro(s) de salud` : null].filter(Boolean).join(', ') + ` a menos de ${e.radio_m} m`;

  const detVuln = v.puntaje == null
    ? 'Faltan capas de agua y zonas inundables'
    : [v.distancia_agua_m != null
        ? `${esc(v.agua_nombre || v.agua_tipo || 'Curso de agua')} a ${fmt(v.distancia_agua_m)} m`
        : `Sin agua a menos de ${v.radio_agua_m} m`,
       v.zona_inundable === true ? 'en zona inundable' : v.zona_inundable === false ? 'fuera de zona inundable' : null,
      ].filter(Boolean).join(', ');

  const detRep = rv.activos > 0
    ? `${rv.activos} reporte(s) activo(s) a menos de ${rv.radio_m} m; el más antiguo hace ${rv.dias_persistencia} días`
    : `Sin reportes activos a menos de ${rv.radio_m} m`;

  const clase = riesgo.clase || 'sin datos';
  const colorClase = COLOR_CLASE[riesgo.clase] || '#888';

  return `
      <div class="rz-total" style="border-color:${colorClase}">
        <span class="rz-num" style="color:${colorClase}">${riesgo.total ?? '–'}</span>
        <span>Índice ambiental y sanitario<br><b style="color:${colorClase}">Riesgo ${clase}</b> <small>sobre 100</small></span>
      </div>
      ${barra('Amenaza', a.puntaje, w.amenaza, detAmenaza + notaTamano)}
      ${barra('Exposición', e.puntaje, w.exposicion, detExpo)}
      ${barra('Vulnerabilidad ambiental', v.puntaje, w.vulnerabilidad, detVuln)}
      ${barra('Reportes vecinales', rv.puntaje, w.reportes, detRep)}
      <p class="rz-nota">Índice preliminar: pesos y umbrales en calibración. Capas: IGN, Mapa Educativo Nacional y &copy; colaboradores de OpenStreetMap.</p>`;
}
