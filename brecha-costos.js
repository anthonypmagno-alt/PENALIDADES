/* Costos compartidos de brecha para Consulta desde Excel. */
(() => {
  'use strict';

  const CLASES_PREVENTIVAS = [
    { clave: 'PREVENTIVA_0_12', rango: '0–12 HORAS', tipo: 'Preventiva · hasta 12 h', detalle: 'Hasta 12 h' },
    { clave: 'PREVENTIVA_12_24', rango: '12–24 HORAS', tipo: 'Preventiva · más de 12 y hasta 24 h', detalle: 'Más de 12 y hasta 24 h' },
    { clave: 'PREVENTIVA_24_36', rango: '24–36 HORAS', tipo: 'Preventiva · más de 24 y hasta 36 h', detalle: 'Más de 24 y hasta 36 h' }
  ];

  let costosCompartidos = new Map();
  let costosCargados = false;
  let cargaEnCurso = null;
  let cambiosPendientes = false;
  let consultaSeleccionada = [];

  const normalizar = value => String(value == null ? '' : value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();
  const claveGuia = value => normalizar(value).replace(/\s+/g, '');
  const claveGuiaPdv = registro => claveGuia(registro && registro.guia) + '|' + normalizar(registro && (registro.pdv || registro.ultimoPunto));
  const unicosPorGuia = registros => {
    const vistos = new Set();
    return (registros || []).filter(registro => {
      const key = claveGuiaPdv(registro);
      if (!key || vistos.has(key)) return false;
      vistos.add(key);
      return true;
    });
  };
  const claveTipo = value => {
    const key = normalizar(value).replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
    return key || 'SIN_TIPO';
  };
  const dinero = value => new Intl.NumberFormat('es-PE', {
    style: 'currency', currency: 'PEN', minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(Number(value) || 0);
  const numero = value => Number(value || 0).toLocaleString('es-PE');
  const escapar = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const registrosActuales = () => typeof excelRegistros !== 'undefined' && Array.isArray(excelRegistros) ? excelRegistros : [];

  function fecha(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (value == null || value === '') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function rangoPreventivoDesdeFecha(registro, ahora) {
    let plazo = fecha(registro.plazo);
    if (!plazo) {
      const actualizacion = fecha(registro.fechaUltimaActualizacion);
      if (actualizacion) plazo = new Date(actualizacion.getTime() + 48 * 3600000);
    }
    if (!plazo) return null;
    const horas = (plazo.getTime() - ahora) / 3600000;
    if (horas < 0) return null;
    return horas <= 12 ? CLASES_PREVENTIVAS[0]
      : horas <= 24 ? CLASES_PREVENTIVAS[1]
        : horas <= 36 ? CLASES_PREVENTIVAS[2] : null;
  }

  function preventiva(registro, ahora = Date.now()) {
    const tipo = normalizar(registro && registro.tipoEspera);
    const match = tipo.match(/(?:^|[^0-9])(\d{1,4})\s*(?:H(?:ORAS?)?|HRS?|HORAS?|HOURS?|小时)(?:$|[^A-Z0-9])/);
    if (match) {
      const horas = Number(match[1]);
      if (horas > 0 && horas <= 36) return horas <= 12 ? CLASES_PREVENTIVAS[0] : horas <= 24 ? CLASES_PREVENTIVAS[1] : CLASES_PREVENTIVAS[2];
      if (horas > 36) return null;
    }

    const duracionTexto = String(registro && registro.duracionEspera != null ? registro.duracionEspera : '').trim().replace(',', '.');
    let duracion = Number(duracionTexto);
    if (!Number.isFinite(duracion)) {
      const hm = duracionTexto.match(/^(\d{1,4})\s*:\s*(\d{1,2})/);
      if (hm) duracion = Number(hm[1]) + Number(hm[2]) / 60;
    }
    if (Number.isFinite(duracion) && duracion > 0) {
      return duracion <= 36 ? (duracion <= 12 ? CLASES_PREVENTIVAS[0] : duracion <= 24 ? CLASES_PREVENTIVAS[1] : CLASES_PREVENTIVAS[2]) : null;
    }
    return rangoPreventivoDesdeFecha(registro || {}, ahora);
  }

  function tarifasActuales() {
    return [...costosCompartidos.entries()].map(([clave, item]) => ({ clave, tipo: item.tipo, costoUnitario: Number(item.costoUnitario) || 0 }));
  }

  function obtenerTiposConfigurables(registros = registrosActuales()) {
    const conteos = new Map();
    const vistos = new Set();
    registros.forEach(registro => {
      const guia = claveGuiaPdv(registro);
      if (!guia || vistos.has(guia)) return;
      vistos.add(guia);
      const prev = preventiva(registro);
      if (prev) {
        conteos.set(prev.clave, (conteos.get(prev.clave) || 0) + 1);
      } else {
        const tipo = String(registro.tipoEspera || '').trim() || 'Sin tipo de interrupción';
        const key = tipo === 'Sin tipo de interrupción' ? 'SIN_TIPO' : claveTipo(tipo);
        const anterior = conteos.get(key) || { cantidad: 0, tipo };
        anterior.cantidad++;
        anterior.tipo = tipo;
        conteos.set(key, anterior);
      }
    });

    const filas = CLASES_PREVENTIVAS.map(item => ({
      clave: item.clave, tipo: item.tipo, detalle: item.detalle,
      cantidad: Number(conteos.get(item.clave) || 0), preventiva: true
    }));
    const tiposPenalizables = new Map();
    conteos.forEach((value, key) => {
      if (CLASES_PREVENTIVAS.some(item => item.clave === key)) return;
      const data = typeof value === 'number' ? { cantidad: value, tipo: key } : value;
      tiposPenalizables.set(key, { clave: key, tipo: data.tipo, detalle: data.tipo, cantidad: data.cantidad, preventiva: false });
    });
    tarifasActuales().forEach(rate => {
      if (!tiposPenalizables.has(rate.clave) && !CLASES_PREVENTIVAS.some(item => item.clave === rate.clave)) {
        tiposPenalizables.set(rate.clave, { clave: rate.clave, tipo: rate.tipo, detalle: rate.tipo, cantidad: 0, preventiva: false });
      }
    });
    return filas.concat([...tiposPenalizables.values()].sort((a, b) => a.tipo.localeCompare(b.tipo, 'es', { numeric: true, sensitivity: 'base' })));
  }

  function tarifa(clave) {
    const value = Number(costosCompartidos.get(clave)?.costoUnitario || 0);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  function resumir(registros, ahora = Date.now()) {
    const unicos = [];
    const vistos = new Set();
    (registros || []).forEach(registro => {
      const key = claveGuiaPdv(registro);
      if (!key || vistos.has(key)) return;
      vistos.add(key);
      unicos.push(registro);
    });

    const filas = new Map(CLASES_PREVENTIVAS.map(item => [item.clave, {
      clasificacion: 'Preventiva', clave: item.clave, tipo: item.tipo, detalle: item.detalle,
      cantidad: 0, costoUnitario: tarifa(item.clave), montoPenalizable: 0, costoEvitado: 0
    }]));
    unicos.forEach(registro => {
      const prev = preventiva(registro, ahora);
      if (prev) {
        filas.get(prev.clave).cantidad++;
        return;
      }
      const raw = String(registro.tipoEspera || '').trim();
      const tipo = raw || 'Sin tipo de interrupción';
      const key = raw ? claveTipo(raw) : 'SIN_TIPO';
      if (!filas.has(key)) filas.set(key, {
        clasificacion: 'Penalizable', clave: key, tipo, detalle: tipo,
        cantidad: 0, costoUnitario: tarifa(key), montoPenalizable: 0, costoEvitado: 0
      });
      filas.get(key).cantidad++;
    });

    const resultado = [...filas.values()];
    resultado.forEach(row => {
      row.costoUnitario = tarifa(row.clave);
      if (row.clasificacion === 'Preventiva') row.costoEvitado = row.cantidad * row.costoUnitario;
      else row.montoPenalizable = row.cantidad * row.costoUnitario;
    });
    return {
      filas: resultado,
      totalGuias: unicos.length,
      totalPenalizable: resultado.reduce((sum, row) => sum + row.montoPenalizable, 0),
      totalEvitado: resultado.reduce((sum, row) => sum + row.costoEvitado, 0)
    };
  }

  function resumenHtml(registros, print = false) {
    const summary = resumir(registros);
    const rows = summary.filas.map(row => '<tr class="' + (row.clasificacion === 'Preventiva' ? 'brecha-preventiva-row' : '') + '"><td>' + escapar(row.clasificacion) + '</td><td>' + escapar(row.detalle) + '</td><td class="brecha-num">' + numero(row.cantidad) + '</td><td class="brecha-num">' + dinero(row.costoUnitario) + '</td><td class="brecha-num">' + dinero(row.montoPenalizable) + '</td><td class="brecha-num brecha-avoided">' + dinero(row.costoEvitado) + '</td></tr>').join('');
    return (print ? '<section class="brecha-summary-print">' : '') +
      '<h4>Cuadro resumen de penalidades · ' + numero(summary.totalGuias) + ' guías</h4>' +
      '<p>El monto de las filas preventivas se muestra en verde como costo evitado; no se suma a la penalidad. Total penalizable: <b>' + dinero(summary.totalPenalizable) + '</b> · Costo evitado: <b class="brecha-avoided">' + dinero(summary.totalEvitado) + '</b>.</p>' +
      '<div class="brecha-summary-table-wrap"><table class="brecha-summary-table" border="1" cellspacing="0" style="border-collapse:collapse;border:1px solid #334155"><thead><tr><th>Clasificación</th><th>Tipo de interrupción</th><th>Guías</th><th>Costo unitario</th><th>Monto penalizable</th><th>Costo evitado</th></tr></thead><tbody>' + rows +
      '</tbody><tfoot><tr><td colspan="2">TOTAL</td><td class="brecha-num">' + numero(summary.totalGuias) + '</td><td></td><td class="brecha-num">' + dinero(summary.totalPenalizable) + '</td><td class="brecha-num brecha-avoided">' + dinero(summary.totalEvitado) + '</td></tr></tfoot></table></div>' +
      (print ? '</section>' : '');
  }

  function ensureStyles() {
    if (document.getElementById('brechaCostStyles')) return;
    const style = document.createElement('style');
    style.id = 'brechaCostStyles';
    style.textContent = `
      .brecha-shared-panel{margin:14px 0 18px;padding:14px 16px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc}
      .brecha-shared-panel>summary{cursor:pointer;font-size:14px;font-weight:800;color:#1e3a5f}
      .brecha-shared-note{margin:10px 0;color:#475569;font-size:12px;line-height:1.5}
      .brecha-shared-status{min-height:18px;margin:5px 0 8px;color:#475569;font-size:12px}
      .brecha-shared-table{width:100%;min-width:720px;border-collapse:collapse}
      .brecha-shared-table th,.brecha-shared-table td{border:1px solid #cbd5e1;padding:7px 9px;font-size:12px}
      .brecha-shared-table th{background:#e2e8f0;color:#1e293b}
      .brecha-shared-table td:first-child{text-align:left;min-width:260px}
      .brecha-shared-table input{width:150px;max-width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:6px;text-align:right}
      .brecha-preventive-row td{background:#f0fdf4}
      .brecha-avoided{color:#15803d!important;font-weight:800!important;background:#dcfce7!important}
      .brecha-num{text-align:right!important;font-variant-numeric:tabular-nums}
      .brecha-cost-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px}
      .brecha-summary-table-wrap{overflow:auto}
      .brecha-summary-table{width:100%;min-width:760px;border-collapse:collapse}
      .brecha-summary-table th,.brecha-summary-table td{border:1px solid #cbd5e1;padding:7px 8px;text-align:left;font-size:12px}
      .brecha-summary-table th{background:#e2e8f0}
      .brecha-summary-table tfoot td{background:#dbeafe;font-weight:800}
      .excel-qr-cost-summary .brecha-summary-table{min-width:760px}
      .brecha-summary-print{margin:0 0 8mm;break-after:avoid;page-break-after:avoid}
      .brecha-summary-print h4{font-size:14pt;margin:0 0 3mm;color:#153e67}
      .brecha-summary-print p{font-size:9pt;margin:2mm 0 4mm}
      .brecha-summary-print .brecha-summary-table{width:100%;min-width:0;table-layout:auto;margin:0 0 5mm;border-collapse:collapse!important;border:1px solid #1f2937!important}
      .brecha-summary-print .brecha-summary-table th,.brecha-summary-print .brecha-summary-table td{font-size:9pt;padding:2mm;border:1px solid #1f2937!important;border-style:solid!important;}
      .brecha-pdv-stats{margin:14px 0 18px;padding:14px 16px;border:1px solid #cbd5e1;border-radius:10px;background:#fff}
      .brecha-pdv-stats>summary{cursor:pointer;font-size:14px;font-weight:800;color:#1e3a5f}
      .brecha-pdv-stats-note{margin:9px 0;color:#475569;font-size:12px;line-height:1.5}
      .brecha-pdv-stats-wrap{overflow:auto}
      .brecha-pdv-stats-table{width:100%;min-width:980px;border-collapse:collapse}
      .brecha-pdv-stats-table th,.brecha-pdv-stats-table td{border:1px solid #cbd5e1;padding:7px 8px;font-size:12px;vertical-align:top}
      .brecha-pdv-stats-table th{background:#e2e8f0;text-align:left}
      .brecha-pdv-stats-table tfoot td{background:#dbeafe;font-weight:800}
      .brecha-pdv-stats-table .brecha-num{text-align:right;white-space:nowrap}
      .brecha-pdv-filter{border:0;background:transparent;padding:0;color:#1d4ed8;font:inherit;font-weight:800;text-align:left;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
      .brecha-pdv-filter:hover{color:#1e3a5f}
      .brecha-pdv-detail summary{cursor:pointer;color:#1d4ed8;font-weight:700;white-space:nowrap}
      .brecha-pdv-detail-body{min-width:600px;padding:10px 0}
      .brecha-pdv-detail-body h5{margin:9px 0 5px;color:#1e3a5f}
      .brecha-pdv-subtable{width:100%;border-collapse:collapse;margin:4px 0 10px}
      .brecha-pdv-subtable th,.brecha-pdv-subtable td{border:1px solid #dbe3ed;padding:5px 7px;font-size:11px}
      .brecha-pdv-subtable th{background:#f1f5f9}
      .brecha-pdv-subtable .brecha-num{text-align:right;white-space:nowrap}
      .brecha-pdv-total{font-weight:800;color:#153e67}
      @media print{.brecha-avoided{color:#15803d!important;background:#dcfce7!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}.brecha-preventive-row td{background:#f0fdf4!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    `;
    document.head.appendChild(style);
  }

  function ensureCostPanel() {
    const oldPanel = document.querySelector('.excel-brecha-cost-panel');
    if (oldPanel) oldPanel.remove();
    if (document.getElementById('brechaCostPanel')) return;
    const summary = document.getElementById('excelPdvSummary');
    if (!summary) return;
    const panel = document.createElement('details');
    panel.id = 'brechaCostPanel';
    panel.className = 'brecha-shared-panel';
    panel.open = true;
    panel.innerHTML = `
      <summary>Costos de brecha compartidos</summary>
      <p class="brecha-shared-note">El administrador define estos importes una sola vez y quedan disponibles para todos los usuarios. Las guías preventivas permiten mostrar el costo evitado en verde; ese importe no se suma al monto penalizable.</p>
      <div id="brechaCostStatus" class="brecha-shared-status" role="status" aria-live="polite">Cargando configuración compartida de Supabase…</div>
      <div class="table-wrap"><table class="brecha-shared-table"><thead><tr><th>Tipo de interrupción / preventiva</th><th>Guías cargadas</th><th>Costo unitario o evitado (S/)</th></tr></thead><tbody id="brechaCostBody"></tbody></table></div>
      <div id="brechaCostActions" class="brecha-cost-actions"><button type="button" class="small" onclick="guardarCostosBrechaCompartidos()">Guardar valores para todos</button><span class="brecha-shared-status" id="brechaCostRoleNote"></span></div>
    `;
    const stats = document.getElementById('excelInterruptionStats');
    (stats || summary).insertAdjacentElement('afterend', panel);
  }

  function ensureStatsPanel() {
    if (document.getElementById('excelInterruptionStats')) return;
    const summary = document.getElementById('excelPdvSummary');
    if (!summary) return;
    const panel = document.createElement('details');
    panel.id = 'excelInterruptionStats';
    panel.className = 'brecha-pdv-stats';
    panel.open = true;
    panel.innerHTML = '<summary>Estadísticas de interrupciones y multa por PDV</summary>' +
      '<p class="brecha-pdv-stats-note">Se recalcula con los filtros activos. Cuenta cada guía una vez dentro de cada PDV; una guía repetida en PDV distintos se cuenta en cada uno. La brecha recurrente usa «Último tipo de problema». La multa acumulada suma el costo configurado por «Tipo de tiempo de espera»; los rangos preventivos se muestran aparte como costo evitado.</p>' +
      '<div class="brecha-pdv-stats-wrap"><table class="brecha-pdv-stats-table"><thead><tr><th>PDV</th><th>Interrupciones<br><small>guías únicas</small></th><th>Operación más reciente<br><small>más frecuente</small></th><th>Brecha / problema<br><small>más recurrente</small></th><th>Multa acumulada</th><th>Costo evitado</th><th>Desglose</th></tr></thead><tbody id="excelInterruptionStatsBody"></tbody><tfoot id="excelInterruptionStatsFoot"></tfoot></table></div>';
    summary.insertAdjacentElement('afterend', panel);
  }

  function entradasOrdenadas(map) {
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es', {numeric:true, sensitivity:'base'}));
  }

  function celdaFrecuente(map, vacio) {
    const top = entradasOrdenadas(map)[0];
    return top ? escapar(top[0]) + ' · ' + numero(top[1]) : escapar(vacio);
  }

  function tablaEstadistica(titulo, rows, columnas) {
    const head = columnas.map(x => '<th>' + x + '</th>').join('');
    const body = rows.length ? rows.map(row => '<tr>' + row.map((value, index) => '<td' + (index > 0 && typeof value === 'number' ? ' class="brecha-num"' : '') + '>' + (typeof value === 'string' ? value : escapar(numero(value))) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + columnas.length + '">Sin datos en este filtro.</td></tr>';
    return '<h5>' + escapar(titulo) + '</h5><table class="brecha-pdv-subtable"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function resumirPorPdv(registros, ahora = Date.now()) {
    const recientes = new Map();
    (registros || []).forEach(registro => {
      const guia = claveGuia(registro && registro.guia);
      const pdv = String(registro && (registro.pdv || registro.ultimoPunto) || '').trim();
      if (!guia || !pdv) return;
      const key = normalizar(pdv) + '|' + guia;
      const actual = recientes.get(key);
      const fechaNueva = fecha(registro.fechaUltimaActualizacion)?.getTime() || 0;
      const fechaActual = fecha(actual && actual.fechaUltimaActualizacion)?.getTime() || 0;
      if (!actual || fechaNueva >= fechaActual) recientes.set(key, registro);
    });
    const pdvs = new Map();
    recientes.forEach(registro => {
      const pdv = String(registro.pdv || registro.ultimoPunto || '').trim() || 'SIN PDV';
      const key = normalizar(pdv);
      if (!pdvs.has(key)) pdvs.set(key, {pdv, guias:0, operaciones:new Map(), problemas:new Map(), montos:new Map(), multa:0, evitado:0});
      const item = pdvs.get(key);
      item.guias++;
      const operacion = String(registro.tipoOperacion || '').trim() || 'Sin tipo de operación';
      item.operaciones.set(operacion, (item.operaciones.get(operacion) || 0) + 1);
      const problema = String(registro.ultimoProblema || '').trim() || 'Sin tipo de problema registrado';
      item.problemas.set(problema, (item.problemas.get(problema) || 0) + 1);
      const preventivaActual = preventiva(registro, ahora);
      const tipo = String(registro.tipoEspera || '').trim() || 'Sin tipo de interrupción';
      const clave = tipo === 'Sin tipo de interrupción' ? 'SIN_TIPO' : claveTipo(tipo);
      const preventivaKey = preventivaActual ? 'PREVENTIVA' : 'PENALIZABLE';
      const montoKey = clave + '|' + preventivaKey;
      if (!item.montos.has(montoKey)) item.montos.set(montoKey, {tipo, cantidad:0, tarifa:tarifa(clave), preventiva:Boolean(preventivaActual), subtotal:0});
      const monto = item.montos.get(montoKey);
      monto.cantidad++;
      monto.subtotal += tarifa(clave);
      if (preventivaActual) item.evitado += tarifa(clave);
      else item.multa += tarifa(clave);
    });
    return [...pdvs.values()].sort((a,b) => a.pdv.localeCompare(b.pdv, 'es', {numeric:true, sensitivity:'base'}));
  }

  function htmlDetallePdv(item) {
    const operaciones = entradasOrdenadas(item.operaciones).map(([tipo,cantidad]) => [escapar(tipo), cantidad]);
    const problemas = entradasOrdenadas(item.problemas).map(([tipo,cantidad]) => [escapar(tipo), cantidad]);
    const montos = [...item.montos.values()].sort((a,b) => b.subtotal-a.subtotal || a.tipo.localeCompare(b.tipo, 'es', {numeric:true, sensitivity:'base'}));
    let acumulado = 0;
    const filasMonto = montos.map(monto => {
      const esPreventiva = monto.preventiva;
      if (!esPreventiva) acumulado += monto.subtotal;
      return [escapar((esPreventiva ? 'Preventiva · ' : '') + monto.tipo), monto.cantidad, dinero(monto.tarifa), dinero(monto.subtotal), esPreventiva ? 'Costo evitado' : dinero(acumulado)];
    });
    return '<div class="brecha-pdv-detail-body">' +
      tablaEstadistica('Cantidad por tipo de operación más reciente', operaciones, ['Tipo de operación', 'Guías']) +
      tablaEstadistica('Recurrencia por último tipo de problema / brecha', problemas, ['Tipo de problema', 'Guías']) +
      tablaEstadistica('Monto de multa por tipo de interrupción', filasMonto, ['Tipo de tiempo de espera', 'Guías', 'Costo unitario', 'Subtotal', 'Multa acumulada']) +
      '<p class="brecha-pdv-total">Multa acumulada: ' + dinero(item.multa) + ' · Costo evitado: ' + dinero(item.evitado) + '</p></div>';
  }

  function renderizarEstadisticasInterrupciones(registros = registrosActuales()) {
    ensureStatsPanel();
    const body = document.getElementById('excelInterruptionStatsBody');
    const foot = document.getElementById('excelInterruptionStatsFoot');
    if (!body || !foot) return;
    const filas = resumirPorPdv(registros);
    body.replaceChildren(); foot.replaceChildren();
    if (!filas.length) {
      body.innerHTML = '<tr><td colspan="7">Carga una consulta para ver estadísticas por PDV.</td></tr>';
      return;
    }
    const totalGuias = filas.reduce((sum,x) => sum + x.guias, 0);
    const totalMulta = filas.reduce((sum,x) => sum + x.multa, 0);
    const totalEvitado = filas.reduce((sum,x) => sum + x.evitado, 0);
    filas.forEach(item => {
      const row = document.createElement('tr');
      const operation = entradasOrdenadas(item.operaciones)[0];
      const problem = entradasOrdenadas(new Map([...item.problemas].filter(([key]) => key !== 'Sin tipo de problema registrado')))[0];
      const cells = [item.pdv, numero(item.guias), operation ? operation[0] + ' · ' + numero(operation[1]) : 'Sin dato', problem ? problem[0] + ' · ' + numero(problem[1]) : 'Sin problema informado', dinero(item.multa), dinero(item.evitado)];
      cells.forEach((value, index) => {
        const cell = document.createElement('td');
        if (index === 0 && typeof window.seleccionarCeldaResumenExcel === 'function') {
          const filter = document.createElement('button'); filter.type = 'button'; filter.className = 'brecha-pdv-filter'; filter.textContent = value; filter.title = 'Filtrar detalle para ' + value;
          filter.addEventListener('click', () => window.seleccionarCeldaResumenExcel(item.pdv, ''));
          cell.appendChild(filter);
        } else cell.textContent = value;
        if (index === 1 || index === 4 || index === 5) cell.className = 'brecha-num';
        row.appendChild(cell);
      });
      const detailCell = document.createElement('td');
      const detail = document.createElement('details'); detail.className = 'brecha-pdv-detail';
      const summary = document.createElement('summary'); summary.textContent = 'Ver desglose';
      detail.appendChild(summary);
      const content = document.createElement('div'); content.innerHTML = htmlDetallePdv(item); detail.appendChild(content);
      detailCell.appendChild(detail); row.appendChild(detailCell); body.appendChild(row);
    });
    const totalOperations = new Set();
    const totalProblems = new Set();
    filas.forEach(x => { x.operaciones.forEach((_,key) => totalOperations.add(key)); x.problemas.forEach((_,key) => totalProblems.add(key)); });
    const row = document.createElement('tr');
    ['TOTAL', numero(totalGuias), totalOperations.size + ' tipos de operación', totalProblems.size + ' tipos de problema', dinero(totalMulta), dinero(totalEvitado), ''].forEach((value,index) => { const cell = document.createElement('td'); cell.textContent = value; if (index === 1 || index === 4 || index === 5) cell.className='brecha-num'; row.appendChild(cell); });
    foot.appendChild(row);
  }

  function ensureModalSummary() {
    const modal = document.getElementById('excelQrModal');
    const groups = document.getElementById('excelQrGroups');
    if (!modal || !groups) return;
    let summary = document.getElementById('excelQrCostSummary');
    if (!summary) {
      summary = document.createElement('div');
      summary.id = 'excelQrCostSummary';
      summary.className = 'excel-qr-cost-summary hidden';
      groups.insertAdjacentElement('beforebegin', summary);
    }
  }

  function renderizarCostosBrecha() {
    ensureCostPanel();
    const body = document.getElementById('brechaCostBody');
    if (!body) return;
    const admin = typeof sesion !== 'undefined' && sesion && sesion.rol === 'ADMINISTRADOR';
    const tipos = obtenerTiposConfigurables();
    body.replaceChildren();
    const roleNote = document.getElementById('brechaCostRoleNote');
    if (roleNote) roleNote.textContent = admin ? 'Administrador: puedes editar y guardar importes compartidos.' : 'Solo lectura: importes definidos por el administrador.';
    const actions = document.getElementById('brechaCostActions');
    if (actions) actions.classList.toggle('hidden', !admin);
    const status = document.getElementById('brechaCostStatus');
    if (!tipos.length) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="3">Carga Track Break para mostrar los tipos de interrupción.</td>';
      body.appendChild(row);
      return;
    }
    tipos.forEach(item => {
      const row = document.createElement('tr');
      if (item.preventiva) row.className = 'brecha-preventive-row';
      const type = document.createElement('td');
      type.textContent = item.tipo;
      const count = document.createElement('td');
      count.className = 'brecha-num';
      count.textContent = numero(item.cantidad);
      const amount = document.createElement('td');
      amount.className = 'brecha-num' + (item.preventiva ? ' brecha-avoided' : '');
      const value = tarifa(item.clave);
      if (admin) {
        const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.max = '999999999999.99'; input.step = '0.01'; input.inputMode = 'decimal';
        input.value = String(value);
        input.setAttribute('aria-label', (item.preventiva ? 'Costo evitado unitario para ' : 'Costo penalizable unitario para ') + item.tipo);
        input.addEventListener('input', () => {
          const next = input.value.trim() === '' ? 0 : Number(input.value);
          if (!Number.isFinite(next) || next < 0) return;
          costosCompartidos.set(item.clave, { tipo: item.tipo, costoUnitario: next });
          cambiosPendientes = true;
          if (status) status.textContent = 'Hay cambios pendientes. Pulsa «Guardar valores para todos» para publicarlos.';
          actualizarResumenActivo();
        });
        amount.appendChild(input);
      } else {
        amount.textContent = dinero(value);
      }
      row.append(type, count, amount);
      body.appendChild(row);
    });
    if (status && costosCargados && !cambiosPendientes) status.textContent = 'Configuración compartida cargada desde Supabase.';
    renderizarEstadisticasInterrupciones();
  }

  function reemplazarCostos(response) {
    const lista = response && Array.isArray(response.costos) ? response.costos : [];
    const next = new Map();
    lista.forEach(item => {
      const key = String(item.clave || '');
      if (!key) return;
      next.set(key, { tipo: String(item.tipo || key), costoUnitario: Number(item.costoUnitario) || 0 });
    });
    costosCompartidos = next;
    costosCargados = true;
    cambiosPendientes = false;
  }

  function rpc(name, payload) {
    return new Promise((resolve, reject) => {
      if (!window.google || !google.script || !google.script.run) return reject(new Error('No está disponible la conexión de Supabase.'));
      const run = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
      if (name === 'listar') run.obtenerCostosBrecha(typeof token !== 'undefined' ? token : '');
      else run.guardarCostosBrecha(typeof token !== 'undefined' ? token : '', payload);
    });
  }

  function cargarCostosCompartidos(forzar = false) {
    if (cargaEnCurso) return cargaEnCurso;
    if (costosCargados && !forzar) return Promise.resolve(costosCompartidos);
    if (cambiosPendientes) return Promise.resolve(costosCompartidos);
    const status = document.getElementById('brechaCostStatus');
    if (status) status.textContent = 'Cargando configuración compartida de Supabase…';
    cargaEnCurso = rpc('listar').then(response => {
      reemplazarCostos(response);
      renderizarCostosBrecha();
      actualizarResumenActivo();
      return costosCompartidos;
    }).catch(error => {
      if (status) status.textContent = 'No se pudo leer la configuración. Ejecuta la actualización SQL y vuelve a cargar. ' + (error && error.message ? error.message : '');
      throw error;
    }).finally(() => { cargaEnCurso = null; });
    return cargaEnCurso;
  }

  async function guardarCostosBrechaCompartidos() {
    if (typeof sesion === 'undefined' || sesion?.rol !== 'ADMINISTRADOR') {
      if (typeof toast === 'function') toast('Solo el rol administrador puede definir estos importes.', false);
      return;
    }
    const rows = obtenerTiposConfigurables().map(item => ({
      clave: item.clave,
      tipo: item.tipo,
      costoUnitario: tarifa(item.clave)
    }));
    const status = document.getElementById('brechaCostStatus');
    const button = document.querySelector('#brechaCostActions button');
    if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
    if (status) status.textContent = 'Guardando importes compartidos en Supabase…';
    try {
      const response = await rpc('guardar', { costos: rows });
      reemplazarCostos(response);
      renderizarCostosBrecha();
      actualizarResumenActivo();
      if (status) status.textContent = 'Importes guardados. Ya están disponibles para todos los usuarios.';
      if (typeof toast === 'function') toast('Costos de brecha guardados para todos los usuarios.', true);
    } catch (error) {
      if (status) status.textContent = 'No se guardaron los importes: ' + (error && error.message ? error.message : 'Error de conexión.');
      if (typeof toast === 'function') toast('No se guardaron los costos de brecha. Revisa la actualización SQL y vuelve a intentar.', false);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Guardar valores para todos'; }
    }
  }

  function htmlResumenCostosBrecha(registros) { return resumenHtml(registros); }
  function actualizarResumenActivo() {
    const panel = document.getElementById('excelQrCostSummary');
    if (panel && !panel.classList.contains('hidden') && consultaSeleccionada.length) panel.innerHTML = resumenHtml(consultaSeleccionada);
  }
  function prepararResumenCostosModal(registros, esConsulta) {
    ensureModalSummary();
    const panel = document.getElementById('excelQrCostSummary');
    if (!panel) return;
    panel.classList.toggle('hidden', !esConsulta);
    panel.innerHTML = esConsulta ? resumenHtml(registros) : '';
  }

  function detallePreventivoTexto(registro, ahora) {
    const value = preventiva(registro, ahora);
    return value ? value.detalle : null;
  }

  function fechaMostrar(value) {
    const parsed = fecha(value);
    return parsed ? parsed.toLocaleString('es-PE') : '';
  }

  function enlazarFunciones() {
    window.renderizarCostosBrecha = renderizarCostosBrecha;
    window.renderizarEstadisticasInterrupciones = renderizarEstadisticasInterrupciones;
    window.generarResumenCostosBrecha = resumir;
    window.htmlResumenCostosBrecha = htmlResumenCostosBrecha;
    window.prepararResumenCostosModal = prepararResumenCostosModal;
    window.etiquetaPreventivaBrecha = detallePreventivoTexto;
    window.claveTipoBrecha = claveTipo;
    window.costoBrechaPorClave = tarifa;
    window.costoUnitarioBrecha = type => tarifa(claveTipo(type));
    window.guardarCostosBrechaCompartidos = guardarCostosBrechaCompartidos;

    if (typeof window.recibirConsulta === 'function' && !window.recibirConsulta.__brechaWrapped) {
      const original = window.recibirConsulta;
      const wrapped = function (...args) {
        const result = original.apply(this, args);
        renderizarCostosBrecha();
        cargarCostosCompartidos().catch(() => {});
        return result;
      };
      wrapped.__brechaWrapped = true;
      window.recibirConsulta = wrapped;
    }

    if (typeof window.mostrarGuiasSeleccionadasQr === 'function' && !window.mostrarGuiasSeleccionadasQr.__brechaWrapped) {
      const original = window.mostrarGuiasSeleccionadasQr;
      const wrapped = function (registros, campoEmpleado, origen) {
        const result = original.apply(this, arguments);
        const esConsulta = String(origen || '').includes('Consulta desde Excel');
        consultaSeleccionada = esConsulta ? unicosPorGuia(registros) : [];
        prepararResumenCostosModal(consultaSeleccionada, esConsulta);
        return result;
      };
      wrapped.__brechaWrapped = true;
      window.mostrarGuiasSeleccionadasQr = wrapped;
    }

    if (typeof window.crearContenidoImpresionQr === 'function' && !window.crearContenidoImpresionQr.__brechaWrapped) {
      const original = window.crearContenidoImpresionQr;
      const wrapped = function (groups) {
        let html = original.apply(this, arguments);
        if (!consultaSeleccionada.length || html.includes('brecha-summary-print')) return html;
        const summary = resumenHtml(consultaSeleccionada, true);
        const printCss = '<style>.brecha-summary-print{margin:0 0 8mm;break-after:avoid;page-break-after:avoid}.brecha-summary-print h4{font-size:14pt;margin:0 0 3mm;color:#153e67}.brecha-summary-print p{font-size:9pt;margin:2mm 0 4mm}.brecha-summary-print .brecha-summary-table{width:100%;min-width:0;table-layout:auto;border-collapse:collapse!important;border:1px solid #1f2937!important;margin:0 0 5mm}.brecha-summary-print .brecha-summary-table th,.brecha-summary-print .brecha-summary-table td{width:auto!important;border:1px solid #1f2937!important;border-style:solid!important;padding:2mm;text-align:left;font-size:9pt}.brecha-summary-print .brecha-summary-table th{background:#e2e8f0;print-color-adjust:exact;-webkit-print-color-adjust:exact}.brecha-summary-print .brecha-summary-table tfoot td{background:#dbeafe;font-weight:bold;print-color-adjust:exact;-webkit-print-color-adjust:exact}.brecha-summary-print .brecha-avoided{color:#15803d!important;background:#dcfce7!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}</style>';
        html = html.replace('</head>', printCss + '</head>');
        return html.replace('<body>', '<body>' + summary);
      };
      wrapped.__brechaWrapped = true;
      window.crearContenidoImpresionQr = wrapped;
    }
  }

  function inicializar() {
    ensureStyles();
    ensureModalSummary();
    ensureStatsPanel();
    ensureCostPanel();
    enlazarFunciones();
    renderizarCostosBrecha();
    renderizarEstadisticasInterrupciones();
    if (typeof window.recibirConsulta !== 'function') {
      document.addEventListener('DOMContentLoaded', () => enlazarFunciones(), { once: true });
    }
    window.addEventListener('focus', () => { if (!cambiosPendientes) cargarCostosCompartidos(true).catch(() => {}); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !cambiosPendientes) cargarCostosCompartidos(true).catch(() => {});
    });
  }

  window.BrechaCostosCompartidos = {
    preventiva, resumir, obtenerTiposConfigurables, claveTipo,
    cargarCostosCompartidos, renderizarCostosBrecha, resumirPorPdv, renderizarEstadisticasInterrupciones
  };
  inicializar();
})();
