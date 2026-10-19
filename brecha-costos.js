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
  let estadisticasRegistros = [];
  const filtrosEstadisticas = { encargado: new Set(), zona: new Set(), pdv: new Set(), operacion: new Set(), problema: new Set(), interrupcion: new Set() };
  const simulacionSeleccionada = new Map();
  const paginasSimulacion = new Map();
  const busquedasSimulacion = new Map();
  const SIMULACION_PAGINA = 100;
  let firmaOpcionesEstadisticas = '';

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
  const redondear2 = value => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
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
      .brecha-pdv-stats-table{width:100%;min-width:1260px;border-collapse:collapse}
      .brecha-pdv-stats-table th,.brecha-pdv-stats-table td{border:1px solid #cbd5e1;padding:7px 8px;font-size:12px;vertical-align:top}
      .brecha-pdv-stats-table th{background:#e2e8f0;text-align:left}
      .brecha-pdv-stats-table tfoot td{background:#dbeafe;font-weight:800}
      .brecha-pdv-stats-table .brecha-num{text-align:right;white-space:nowrap}
      .brecha-stats-manager-row>td{padding:9px!important;background:#f8fafc}
      .brecha-group-manager,.brecha-group-zone{border:1px solid #dbe3ed;border-radius:8px;background:#fff;overflow:hidden}
      .brecha-group-manager{border-color:#bfdbfe}
      .brecha-group-manager>summary,.brecha-group-zone>summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer;list-style:none;padding:10px 12px;color:#1e3a5f}
      .brecha-group-manager>summary::-webkit-details-marker,.brecha-group-zone>summary::-webkit-details-marker{display:none}
      .brecha-group-manager>summary{background:#eff6ff;font-size:12px}
      .brecha-group-manager>summary .brecha-group-title{font-size:13px;font-weight:800}
      .brecha-group-zone{margin:8px 10px;border-color:#e2e8f0}
      .brecha-group-zone>summary{background:#f8fafc;font-size:11px}
      .brecha-group-zone>summary .brecha-group-title{font-weight:800}
      .brecha-group-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 7px;border:1px solid #dbe3ed;border-radius:999px;background:#fff;color:#475569;font-size:10px;font-weight:700;white-space:nowrap}
      .brecha-group-content{padding:0 10px 10px}
      .brecha-group-zone-content{padding:0 8px 8px;overflow:auto}
      .brecha-group-pdv-table{width:100%;min-width:1180px;border-collapse:collapse}
      .brecha-group-pdv-table th,.brecha-group-pdv-table td{border:1px solid #dbe3ed;padding:6px 7px;font-size:11px;vertical-align:top}
      .brecha-group-pdv-table th{background:#f1f5f9;text-align:left}
      .brecha-group-pdv-table .brecha-num{text-align:right;white-space:nowrap}
      .brecha-group-pdv-table .brecha-pdv-detail-body{min-width:600px}
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
      .brecha-stats-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:10px;margin:12px 0}
      .brecha-stats-filter{position:relative;border:1px solid #cbd5e1;border-radius:8px;background:#fff}
      .brecha-stats-filter>summary{cursor:pointer;list-style:none;padding:9px 11px;display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:700;color:#1e3a5f}
      .brecha-stats-filter>summary::-webkit-details-marker{display:none}
      .brecha-stats-filter>summary span{color:#64748b;font-weight:600;white-space:nowrap}
      .brecha-stats-filter-menu{position:absolute;z-index:5;top:calc(100% + 3px);left:0;right:0;max-height:320px;overflow:auto;padding:9px;background:white;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 8px 22px #0f172a24}
      .brecha-stats-filter-actions{display:flex;gap:8px;margin-bottom:8px}
      .brecha-stats-filter-actions button,.brecha-sim-actions button,.brecha-sim-pager button{border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#1e3a5f;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer}
      .brecha-stats-filter-search,.brecha-sim-search{box-sizing:border-box;width:100%;margin:0 0 7px;padding:7px 8px;border:1px solid #cbd5e1;border-radius:6px}
      .brecha-stats-filter-options{display:grid;gap:3px;max-height:220px;overflow:auto}
      .brecha-stats-filter-options label{display:flex;align-items:flex-start;gap:6px;padding:4px;border-radius:4px;font-size:11px;line-height:1.35;cursor:pointer}
      .brecha-stats-filter-options label:hover{background:#f1f5f9}
      .brecha-stats-filter-options input{margin:1px 0 0;flex:0 0 auto}
      .brecha-stats-filter-empty{color:#64748b;padding:8px;font-size:11px}
      .brecha-stats-reset{margin:0 0 10px;border:1px solid #cbd5e1;border-radius:7px;padding:7px 10px;background:#f8fafc;color:#334155;font-weight:700;cursor:pointer}
      .brecha-operation-simulation{margin:12px 0 14px;padding:12px;border:1px solid #bfdbfe;border-radius:9px;background:#f8fbff}
      .brecha-operation-simulation h4{margin:0 0 5px;color:#1e3a5f;font-size:13px}
      .brecha-operation-simulation p{margin:0 0 8px;color:#64748b;font-size:11px;line-height:1.45}
      .brecha-operation-simulation-wrap{overflow:auto}
      .brecha-operation-simulation-table{width:100%;min-width:720px;border-collapse:collapse;background:#fff}
      .brecha-operation-simulation-table th,.brecha-operation-simulation-table td{border:1px solid #cbd5e1;padding:7px 8px;text-align:left;font-size:11px}
      .brecha-operation-simulation-table th{background:#e2e8f0;color:#1e293b}
      .brecha-operation-simulation-table tfoot td{background:#dbeafe;font-weight:800}
      .brecha-operation-simulation-table td.brecha-num{text-align:right;white-space:nowrap}
      .brecha-operation-simulation-table input[type=number]{width:95px;padding:5px 6px;border:1px solid #cbd5e1;border-radius:5px;text-align:right}
      .brecha-operation-simulation-table input[type=checkbox]{width:17px;height:17px}
      .brecha-stats-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin:10px 0 14px}
      .brecha-stats-chart{min-width:0;border:1px solid #e2e8f0;border-radius:9px;background:#fff;padding:12px}
      .brecha-stats-chart h4{margin:0 0 10px;color:#1e3a5f;font-size:12px}
      .brecha-stats-bars{display:grid;gap:8px}
      .brecha-stats-bar{display:grid;grid-template-columns:minmax(85px,42%) minmax(50px,1fr) auto;align-items:center;gap:7px;font-size:10px}
      .brecha-stats-bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155}
      .brecha-stats-bar-track{height:10px;border-radius:99px;background:#f1f5f9;overflow:hidden}
      .brecha-stats-bar-fill{display:block;height:100%;min-width:2px;border-radius:99px;background:#3b82f6}
      .brecha-stats-chart:nth-child(2) .brecha-stats-bar-fill{background:#f59e0b}
      .brecha-stats-chart:nth-child(3) .brecha-stats-bar-fill{background:#0f766e}
      .brecha-stats-bar-value{white-space:nowrap;font-weight:700;color:#1e293b}
      .brecha-sim-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:9px;margin:10px 0 13px}
      .brecha-sim-card{padding:10px 12px;border:1px solid #dbe3ed;border-radius:8px;background:#f8fafc}
      .brecha-sim-card span{display:block;color:#64748b;font-size:10px;font-weight:700}
      .brecha-sim-card b{display:block;margin-top:4px;color:#153e67;font-size:16px;font-variant-numeric:tabular-nums}
      .brecha-sim-card.exonerado b{color:#15803d}
      .brecha-sim-note{margin:2px 0 10px;color:#64748b;font-size:11px;line-height:1.45}
      .brecha-sim-note .brecha-stats-reset{margin:5px 0 0;padding:5px 8px;font-size:10px}
      .brecha-sim-box{margin-top:12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;padding:9px}
      .brecha-sim-box>summary{cursor:pointer;color:#1e3a5f;font-size:12px;font-weight:800}
      .brecha-sim-tools{display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:8px;align-items:center;margin:9px 0}
      .brecha-sim-actions{display:flex;flex-wrap:wrap;gap:6px}
      .brecha-sim-bulk{display:flex;align-items:end;gap:8px;flex-wrap:wrap;margin:0 0 9px}
      .brecha-sim-bulk label{display:grid;gap:4px;color:#475569;font-size:10px;font-weight:700}
      .brecha-sim-bulk input{width:130px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px}
      .brecha-sim-bulk button{border:1px solid #bfdbfe;border-radius:6px;padding:6px 9px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:700;cursor:pointer}
      .brecha-sim-table-wrap{overflow:auto}
      .brecha-sim-table{width:100%;min-width:720px;border-collapse:collapse;background:#fff}
      .brecha-sim-table th,.brecha-sim-table td{border:1px solid #dbe3ed;padding:6px 7px;text-align:left;font-size:10px;vertical-align:top}
      .brecha-sim-table th{background:#e2e8f0;color:#1e293b;position:sticky;top:0}
      .brecha-sim-table td:first-child,.brecha-sim-table th:first-child{text-align:center;width:38px}
      .brecha-sim-table .brecha-num{white-space:nowrap}
      .brecha-sim-preventiva{color:#15803d;font-weight:700}
      .brecha-sim-pager{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px;color:#64748b;font-size:11px}
      .brecha-sim-pager button:disabled{opacity:.45;cursor:default}
      @media(max-width:640px){.brecha-sim-tools{grid-template-columns:1fr}.brecha-stats-bar{grid-template-columns:minmax(70px,38%) minmax(40px,1fr) auto}}
      @media print{.brecha-avoided{color:#15803d!important;background:#dcfce7!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}.brecha-preventive-row td{background:#f0fdf4!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    `;
    document.head.appendChild(style);
  }

  function ensureCostPanel() {
    const oldPanel = document.querySelector('.excel-brecha-cost-panel');
    if (oldPanel) oldPanel.remove();
    if (document.getElementById('brechaCostPanel')) return;
    const mount = document.getElementById('statsModuleMount');
    if (!mount) return;
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
    if (stats && stats.parentElement === mount) stats.insertAdjacentElement('afterend', panel);
    else mount.appendChild(panel);
  }

  function ensureStatsPanel() {
    if (document.getElementById('excelInterruptionStats')) return;
    const mount = document.getElementById('statsModuleMount');
    if (!mount) return;
    const panel = document.createElement('details');
    panel.id = 'excelInterruptionStats';
    panel.className = 'brecha-pdv-stats';
    panel.open = true;
    panel.innerHTML = '<summary>Estadísticas de interrupciones y multa por PDV</summary>' +
      '<p class="brecha-pdv-stats-note">Cuenta cada guía una vez dentro de cada PDV; una guía repetida en PDV distintos se cuenta en cada uno. Los PDV se agrupan por encargado y zona: se usa «Zona» si existe; de lo contrario, el área asignada del catálogo y, como último recurso, la región. La brecha recurrente usa «Último tipo de problema». La multa acumulada suma el costo configurado por «Tipo de tiempo de espera»; los rangos preventivos se muestran aparte como costo evitado. Esta vista es independiente de Consulta desde Excel y Penalidades, y analiza la última consulta compartida. Usa los filtros de abajo para acotar este análisis.</p>' +
      '<div class="brecha-stats-filters" id="brechaStatsFilters"></div><button type="button" id="brechaStatsClearFilters" class="brecha-stats-reset">Limpiar filtros de estadísticas</button>' +
      '<div class="brecha-sim-summary" id="brechaSimulationSummary"></div><p class="brecha-sim-note">Simulación temporal: marca las guías penalizables y define el porcentaje de exoneración por guía. No modifica decisiones reales ni guarda cambios. Las guías preventivas no se pueden marcar porque no generan multa. <button type="button" id="brechaSimulationClear" class="brecha-stats-reset">Limpiar selección simulada</button></p>' +
      '<section class="brecha-operation-simulation"><h4>Simular exoneración por operación más reciente</h4><p>Marca una operación y aplica un porcentaje a todas sus guías penalizables dentro de los filtros actuales. Puedes ajustar las guías individualmente desde el desglose de cada PDV.</p><div class="brecha-operation-simulation-wrap"><table class="brecha-operation-simulation-table"><thead><tr><th>Operación más reciente</th><th>Guías penalizables</th><th>Multa actual</th><th>Monto exonerado</th><th>% exoneración</th><th>Simular</th></tr></thead><tbody id="excelOperationSimulationBody"></tbody><tfoot id="excelOperationSimulationFoot"></tfoot></table></div></section>' +
      '<div class="brecha-stats-charts" id="excelInterruptionCharts"></div>' +
      '<div class="brecha-pdv-stats-wrap"><table class="brecha-pdv-stats-table"><thead><tr><th>Encargado · zona · PDV</th><th>Interrupciones<br><small>guías únicas</small></th><th>Multa acumulada</th><th>Monto exonerado<br><small>simulado</small></th><th>Saldo<br><small>simulado</small></th><th>Costo evitado</th><th>Desglose y simulación</th></tr></thead><tbody id="excelInterruptionStatsBody"></tbody><tfoot id="excelInterruptionStatsFoot"></tfoot></table></div>';
    mount.appendChild(panel);
    enlazarControlesEstadisticas();
  }

  function valorEstadistica(registro, campo) {
    if (campo === 'pdv') return String(registro && (registro.pdv || registro.ultimoPunto) || '').trim() || 'Sin PDV';
    if (campo === 'encargado') return String(registro && registro.encargado || '').trim() || 'Sin encargado';
    if (campo === 'zona') return String(registro && (registro.zona || registro.area || registro.region) || '').trim() || 'Sin zona asignada';
    if (campo === 'operacion') return String(registro && registro.tipoOperacion || '').trim() || 'Sin tipo de operación';
    if (campo === 'problema') return String(registro && registro.ultimoProblema || '').trim() || 'Sin tipo de problema registrado';
    return String(registro && registro.tipoEspera || '').trim() || 'Sin tipo de interrupción';
  }

  function unicosActualizadosPorPdv(registros) {
    const recientes = new Map();
    (registros || []).forEach(registro => {
      const key = claveGuiaPdv(registro);
      if (!key || !key.split('|')[0]) return;
      const actual = recientes.get(key);
      const fechaNueva = fecha(registro && registro.fechaUltimaActualizacion)?.getTime() || 0;
      const fechaActual = fecha(actual && actual.fechaUltimaActualizacion)?.getTime() || 0;
      if (!actual || fechaNueva >= fechaActual) recientes.set(key, registro);
    });
    return [...recientes.values()];
  }

  function enlazarControlesEstadisticas() {
    const root = document.getElementById('brechaStatsFilters');
    if (root && !root.dataset.bound) {
      root.dataset.bound = '1';
      root.addEventListener('change', event => {
        const checkbox = event.target.closest('input[data-stat-option]');
        if (!checkbox) return;
        const details = checkbox.closest('[data-stat-filter]');
        const field = details && details.dataset.statFilter;
        if (!field || !filtrosEstadisticas[field]) return;
        filtrosEstadisticas[field] = new Set([...details.querySelectorAll('input[data-stat-option]:checked')].map(input => input.value));
        actualizarEtiquetaFiltroEstadistica(details, field);
        renderizarEstadisticasInterrupciones(estadisticasRegistros);
      });
      root.addEventListener('input', event => {
        const input = event.target.closest('input[data-stat-search]');
        if (!input) return;
        const query = normalizar(input.value);
        input.closest('.brecha-stats-filter-menu').querySelectorAll('.brecha-stats-filter-options label').forEach(label => {
          label.hidden = query && !normalizar(label.textContent).includes(query);
        });
      });
      root.addEventListener('click', event => {
        const button = event.target.closest('button[data-stat-action]');
        if (!button) return;
        const details = button.closest('[data-stat-filter]');
        const field = details && details.dataset.statFilter;
        if (!field || !filtrosEstadisticas[field]) return;
        if (button.dataset.statAction === 'all') {
          filtrosEstadisticas[field] = new Set([...details.querySelectorAll('input[data-stat-option]')].map(input => input.value));
        } else filtrosEstadisticas[field].clear();
        details.querySelectorAll('input[data-stat-option]').forEach(input => { input.checked = filtrosEstadisticas[field].has(input.value); });
        actualizarEtiquetaFiltroEstadistica(details, field);
        renderizarEstadisticasInterrupciones(estadisticasRegistros);
      });
    }
    const clear = document.getElementById('brechaStatsClearFilters');
    if (clear && !clear.dataset.bound) {
      clear.dataset.bound = '1';
      clear.addEventListener('click', () => {
        Object.values(filtrosEstadisticas).forEach(set => set.clear());
        document.querySelectorAll('#brechaStatsFilters [data-stat-filter]').forEach(details => {
          details.querySelectorAll('input[data-stat-option]').forEach(input => { input.checked = false; });
          actualizarEtiquetaFiltroEstadistica(details, details.dataset.statFilter);
        });
        renderizarEstadisticasInterrupciones(estadisticasRegistros);
      });
    }
    const clearSimulation = document.getElementById('brechaSimulationClear');
    if (clearSimulation && !clearSimulation.dataset.bound) {
      clearSimulation.dataset.bound = '1';
      clearSimulation.addEventListener('click', () => {
        simulacionSeleccionada.clear();
        renderizarEstadisticasInterrupciones(estadisticasRegistros);
      });
    }
    const operationBody = document.getElementById('excelOperationSimulationBody');
    if (operationBody && !operationBody.dataset.bound) {
      operationBody.dataset.bound = '1';
      operationBody.addEventListener('change', event => {
        const checkbox = event.target.closest('input[data-op-sim-check]');
        if (checkbox) {
          const row = checkbox.closest('tr');
          const percent = Number(row.querySelector('[data-op-sim-percent]')?.value || 100);
          aplicarSimulacionOperacion(checkbox.value, percent, checkbox.checked);
          renderizarEstadisticasInterrupciones(estadisticasRegistros);
          return;
        }
        const percentInput = event.target.closest('input[data-op-sim-percent]');
        if (!percentInput) return;
        const row = percentInput.closest('tr');
        const checkboxInRow = row && row.querySelector('input[data-op-sim-check]');
        if (checkboxInRow && (checkboxInRow.checked || checkboxInRow.indeterminate)) {
          aplicarSimulacionOperacion(checkboxInRow.value, Number(percentInput.value) || 0, true);
          renderizarEstadisticasInterrupciones(estadisticasRegistros);
        }
      });
    }
  }

  function actualizarEtiquetaFiltroEstadistica(details, field) {
    if (!details) return;
    const selected = filtrosEstadisticas[field] || new Set();
    const available = details.querySelectorAll('input[data-stat-option]').length;
    const label = details.querySelector('[data-stat-count]');
    if (label) label.textContent = !selected.size || selected.size >= available ? 'Todos' : selected.size + ' seleccionados';
  }

  function actualizarOpcionesFiltrosEstadisticas(registros) {
    const root = document.getElementById('brechaStatsFilters');
    if (!root) return;
    const fields = [
      ['encargado', 'Encargado'], ['zona', 'Zona / área asignada'], ['pdv', 'PDV'], ['operacion', 'Operación más reciente'],
      ['problema', 'Tipo de problema / brecha'], ['interrupcion', 'Tipo de interrupción']
    ];
    const options = {};
    fields.forEach(([field]) => {
      const values = new Map();
      (registros || []).forEach(registro => {
        const label = valorEstadistica(registro, field);
        values.set(normalizar(label), label);
      });
      options[field] = [...values.entries()].sort((a,b) => a[1].localeCompare(b[1], 'es', {numeric:true, sensitivity:'base'}));
    });
    const signature = JSON.stringify(options);
    if (signature === firmaOpcionesEstadisticas) return;
    firmaOpcionesEstadisticas = signature;
    root.innerHTML = fields.map(([field, title]) => {
      const all = options[field];
      const selected = filtrosEstadisticas[field];
      for (const value of [...selected]) if (!all.some(([key]) => key === value)) selected.delete(value);
      const rows = all.map(([key, label]) => '<label><input type="checkbox" data-stat-option value="' + escapar(key) + '" ' + (selected.has(key) ? 'checked' : '') + '><span>' + escapar(label) + '</span></label>').join('');
      return '<details class="brecha-stats-filter" data-stat-filter="' + field + '"><summary>' + escapar(title) + '<span data-stat-count></span></summary><div class="brecha-stats-filter-menu"><div class="brecha-stats-filter-actions"><button type="button" data-stat-action="all">Seleccionar todos</button><button type="button" data-stat-action="clear">Limpiar</button></div><input class="brecha-stats-filter-search" type="search" data-stat-search placeholder="Buscar ' + escapar(title.toLowerCase()) + '"><div class="brecha-stats-filter-options">' + (rows || '<span class="brecha-stats-filter-empty">Sin opciones</span>') + '</div></div></details>';
    }).join('');
    fields.forEach(([field]) => actualizarEtiquetaFiltroEstadistica(root.querySelector('[data-stat-filter="' + field + '"]'), field));
    enlazarControlesEstadisticas();
  }

  function filtrarEstadisticas(registros) {
    return unicosActualizadosPorPdv(registros).filter(registro => Object.entries(filtrosEstadisticas).every(([field, selected]) => {
      if (!selected.size) return true;
      return selected.has(normalizar(valorEstadistica(registro, field)));
    }));
  }

  function renderizarResumenSimulacion(registros = estadisticasRegistros) {
    const root = document.getElementById('brechaSimulationSummary');
    if (!root) return;
    const unicos = filtrarEstadisticas(registros);
    let multaActual = 0;
    let multaMarcada = 0;
    let guiasMarcadas = 0;
    unicos.forEach(registro => {
      if (preventiva(registro)) return;
      const tipo = String(registro.tipoEspera || '').trim();
      const monto = tarifa(tipo ? claveTipo(tipo) : 'SIN_TIPO');
      multaActual += monto;
      const key = claveGuiaPdv(registro);
      if (simulacionSeleccionada.has(key)) {
        multaMarcada += redondear2(monto * Math.max(0, Math.min(100, Number(simulacionSeleccionada.get(key)) || 0)) / 100);
        guiasMarcadas++;
      }
    });
    const restante = Math.max(0, multaActual - multaMarcada);
    root.innerHTML = '<div class="brecha-sim-card"><span>Guías marcadas</span><b>' + numero(guiasMarcadas) + '</b></div>' +
      '<div class="brecha-sim-card"><span>Multa actual de la consulta</span><b>' + dinero(multaActual) + '</b></div>' +
      '<div class="brecha-sim-card exonerado"><span>Monto simulado a exonerar</span><b>' + dinero(multaMarcada) + '</b></div>' +
      '<div class="brecha-sim-card"><span>Multa restante simulada</span><b>' + dinero(restante) + '</b></div>';
  }

  function aplicarSimulacionOperacion(operationKey, percent, seleccionar) {
    const valor = Math.max(0, Math.min(100, Number(percent) || 0));
    filtrarEstadisticas(estadisticasRegistros).forEach(registro => {
      if (normalizar(valorEstadistica(registro, 'operacion')) !== operationKey || preventiva(registro)) return;
      const key = claveGuiaPdv(registro);
      if (seleccionar) simulacionSeleccionada.set(key, valor);
      else simulacionSeleccionada.delete(key);
    });
  }

  function renderizarSimulacionOperaciones(registros) {
    const body = document.getElementById('excelOperationSimulationBody');
    const foot = document.getElementById('excelOperationSimulationFoot');
    if (!body || !foot) return;
    const groups = new Map();
    unicosActualizadosPorPdv(registros).forEach(registro => {
      if (preventiva(registro)) return;
      const operation = valorEstadistica(registro, 'operacion');
      const key = normalizar(operation);
      if (!groups.has(key)) groups.set(key, {key, operation, registros:[], multa:0, exonerado:0, porcentajes:[]});
      const group = groups.get(key);
      group.registros.push(registro);
      const costo = tarifa(registro.tipoEspera ? claveTipo(registro.tipoEspera) : 'SIN_TIPO');
      group.multa += costo;
      if (simulacionSeleccionada.has(claveGuiaPdv(registro))) {
        const percent = Math.max(0, Math.min(100, Number(simulacionSeleccionada.get(claveGuiaPdv(registro))) || 0));
        group.exonerado += redondear2(costo * percent / 100);
        group.porcentajes.push(percent);
      }
    });
    const rows = [...groups.values()].sort((a,b) => b.multa-a.multa || a.operation.localeCompare(b.operation, 'es', {numeric:true, sensitivity:'base'}));
    body.innerHTML = rows.length ? rows.map(group => {
      const selected = group.porcentajes.length;
      const allSelected = selected > 0 && selected === group.registros.length;
      const uniquePercents = [...new Set(group.porcentajes)];
      const percentageMixed = selected > 0 && uniquePercents.length > 1;
      const isMixed = selected > 0 && (!allSelected || percentageMixed);
      const percentageValue = !selected ? '100' : uniquePercents.length === 1 ? String(uniquePercents[0]) : '';
      return '<tr><td>' + escapar(group.operation) + '</td><td class="brecha-num">' + numero(group.registros.length) + '</td><td class="brecha-num">' + dinero(group.multa) + '</td><td class="brecha-num">' + dinero(group.exonerado) + '</td>' +
        '<td><input type="number" min="0" max="100" step="0.01" value="' + percentageValue + '" placeholder="Mixto" data-op-sim-percent aria-label="Porcentaje de exoneración para la operación ' + escapar(group.operation) + '"></td>' +
        '<td><input type="checkbox" data-op-sim-check value="' + escapar(group.key) + '" ' + (allSelected ? 'checked' : '') + (isMixed ? ' data-indeterminate="true"' : '') + ' aria-label="Simular exoneración para operación ' + escapar(group.operation) + '"></td></tr>';
    }).join('') : '<tr><td colspan="6">No hay guías penalizables para las operaciones y filtros seleccionados.</td></tr>';
    body.querySelectorAll('input[data-op-sim-check][data-indeterminate="true"]').forEach(input => { input.indeterminate = true; });
    const totalGuides = rows.reduce((sum, item) => sum + item.registros.length, 0);
    const totalFine = rows.reduce((sum, item) => sum + item.multa, 0);
    const totalExempt = rows.reduce((sum, item) => sum + item.exonerado, 0);
    const percent = totalFine ? (totalExempt / totalFine * 100).toLocaleString('es-PE', {minimumFractionDigits:2, maximumFractionDigits:2}) + '%' : '0.00%';
    foot.innerHTML = rows.length ? '<tr><td>TOTAL</td><td class="brecha-num">' + numero(totalGuides) + '</td><td class="brecha-num">' + dinero(totalFine) + '</td><td class="brecha-num">' + dinero(totalExempt) + '</td><td>' + percent + '</td><td></td></tr>' : '';
  }

  function graficoBarras(titulo, datos, formato, aria) {
    const top = datos.filter(item => Number(item[1]) > 0).sort((a,b) => b[1]-a[1] || String(a[0]).localeCompare(String(b[0]), 'es', {numeric:true, sensitivity:'base'})).slice(0,8);
    const max = top.length ? Math.max(...top.map(item => Number(item[1]) || 0)) : 0;
    const bars = top.map(([label, value]) => {
      const width = max ? Math.max(2, Number(value) / max * 100) : 0;
      return '<div class="brecha-stats-bar" title="' + escapar(label + ': ' + formato(value)) + '"><span class="brecha-stats-bar-label">' + escapar(label) + '</span><span class="brecha-stats-bar-track"><i class="brecha-stats-bar-fill" style="width:' + width.toFixed(1) + '%"></i></span><span class="brecha-stats-bar-value">' + escapar(formato(value)) + '</span></div>';
    }).join('') || '<div class="brecha-stats-filter-empty">Sin datos para los filtros seleccionados.</div>';
    return '<section class="brecha-stats-chart" role="img" aria-label="' + escapar(aria) + '"><h4>' + escapar(titulo) + '</h4><div class="brecha-stats-bars">' + bars + '</div></section>';
  }

  function renderizarGraficosEstadisticas(filas) {
    const root = document.getElementById('excelInterruptionCharts');
    if (!root) return;
    const operaciones = new Map();
    const problemas = new Map();
    filas.forEach(item => {
      item.operaciones.forEach((count, label) => operaciones.set(label, (operaciones.get(label) || 0) + count));
      item.problemas.forEach((count, label) => problemas.set(label, (problemas.get(label) || 0) + count));
    });
    root.innerHTML = graficoBarras('Interrupciones por operación más reciente', [...operaciones], numero, 'Guías por tipo de operación más reciente') +
      graficoBarras('Brechas o problemas más recurrentes', [...problemas].filter(([label]) => label !== 'Sin tipo de problema registrado'), numero, 'Guías por problema más recurrente') +
      graficoBarras('Multa acumulada por PDV (S/)', filas.map(item => [item.pdv, item.multa]), dinero, 'Monto estimado de multa por PDV');
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
    const pdvs = new Map();
    unicosActualizadosPorPdv(registros).forEach(registro => {
      const pdv = String(registro.pdv || registro.ultimoPunto || '').trim() || 'SIN PDV';
      const key = normalizar(pdv);
      if (!pdvs.has(key)) pdvs.set(key, {pdv, guias:0, operaciones:new Map(), problemas:new Map(), montos:new Map(), multa:0, evitado:0, exonerado:0, multaRestante:0, registros:[], _encargados:new Map(), _zonas:new Map()});
      const item = pdvs.get(key);
      item.registros.push(registro);
      const encargadoRegistro = valorEstadistica(registro, 'encargado');
      const zonaRegistro = valorEstadistica(registro, 'zona');
      item._encargados.set(normalizar(encargadoRegistro), encargadoRegistro);
      item._zonas.set(normalizar(zonaRegistro), zonaRegistro);
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
      else {
        item.multa += tarifa(clave);
        const selectedPercent = simulacionSeleccionada.get(claveGuiaPdv(registro));
        if (selectedPercent != null) {
          const exonerado = redondear2(tarifa(clave) * Math.max(0, Math.min(100, Number(selectedPercent) || 0)) / 100);
          monto.exonerado = (monto.exonerado || 0) + exonerado;
          item.exonerado += exonerado;
        }
      }
    });
    pdvs.forEach(item => {
      item.multaRestante = Math.max(0, item.multa - item.exonerado);
      item.encargado = item._encargados.size === 1 ? [...item._encargados.values()][0] : item._encargados.size ? 'Varios encargados' : 'Sin encargado';
      item.zona = item._zonas.size === 1 ? [...item._zonas.values()][0] : item._zonas.size ? 'Varias zonas' : 'Sin zona asignada';
      delete item._encargados; delete item._zonas;
    });
    return [...pdvs.values()].sort((a,b) => a.pdv.localeCompare(b.pdv, 'es', {numeric:true, sensitivity:'base'}));
  }

  function acumularTotalesGrupo(grupo, pdv) {
    grupo.pdvs.push(pdv);
    grupo.guias += pdv.guias;
    grupo.multa += pdv.multa;
    grupo.exonerado += pdv.exonerado;
    grupo.saldo += pdv.multaRestante;
    grupo.evitado += pdv.evitado;
  }

  function agruparEstadisticasPorEncargadoZona(filas) {
    const encargados = new Map();
    (filas || []).forEach(pdv => {
      const encargado = pdv.encargado || 'Sin encargado';
      const zona = pdv.zona || 'Sin zona asignada';
      const encargadoKey = normalizar(encargado) || 'SIN ENCARGADO';
      const zonaKey = normalizar(zona) || 'SIN ZONA ASIGNADA';
      if (!encargados.has(encargadoKey)) encargados.set(encargadoKey, {key:encargadoKey, nombre:encargado, zonas:new Map(), pdvs:[], guias:0, multa:0, exonerado:0, saldo:0, evitado:0});
      const encargadoGroup = encargados.get(encargadoKey);
      if (!encargadoGroup.zonas.has(zonaKey)) encargadoGroup.zonas.set(zonaKey, {key:zonaKey, nombre:zona, pdvs:[], guias:0, multa:0, exonerado:0, saldo:0, evitado:0});
      acumularTotalesGrupo(encargadoGroup, pdv);
      acumularTotalesGrupo(encargadoGroup.zonas.get(zonaKey), pdv);
    });
    const ordenar = (a,b) => a.nombre.localeCompare(b.nombre, 'es', {numeric:true, sensitivity:'base'});
    return [...encargados.values()].sort(ordenar).map(encargado => ({
      ...encargado,
      zonas:[...encargado.zonas.values()].sort(ordenar).map(zona => ({...zona, pdvs:zona.pdvs.sort((a,b) => a.pdv.localeCompare(b.pdv, 'es', {numeric:true, sensitivity:'base'}))}))
    }));
  }

  function htmlDetallePdv(item) {
    const operaciones = entradasOrdenadas(item.operaciones).map(([tipo,cantidad]) => [escapar(tipo), cantidad]);
    const problemas = entradasOrdenadas(item.problemas).map(([tipo,cantidad]) => [escapar(tipo), cantidad]);
    const montos = [...item.montos.values()].sort((a,b) => b.subtotal-a.subtotal || a.tipo.localeCompare(b.tipo, 'es', {numeric:true, sensitivity:'base'}));
    let acumulado = 0;
    const filasMonto = montos.map(monto => {
      const esPreventiva = monto.preventiva;
      const exonerado = Number(monto.exonerado || 0);
      const saldoSimulado = esPreventiva ? 0 : Math.max(0, monto.subtotal - exonerado);
      if (!esPreventiva) acumulado += monto.subtotal;
      return [escapar((esPreventiva ? 'Preventiva · ' : '') + monto.tipo), monto.cantidad, dinero(monto.tarifa), dinero(monto.subtotal), esPreventiva ? dinero(0) : dinero(exonerado), esPreventiva ? 'Costo evitado' : dinero(saldoSimulado), esPreventiva ? 'Costo evitado' : dinero(acumulado)];
    });
    return '<div class="brecha-pdv-detail-body">' +
      tablaEstadistica('Cantidad por tipo de operación más reciente', operaciones, ['Tipo de operación', 'Guías']) +
      tablaEstadistica('Recurrencia por último tipo de problema / brecha', problemas, ['Tipo de problema', 'Guías']) +
      tablaEstadistica('Monto de multa por tipo de interrupción', filasMonto, ['Tipo de tiempo de espera', 'Guías', 'Costo unitario', 'Subtotal', 'Monto exonerado', 'Saldo simulado', 'Multa acumulada']) +
      '<p class="brecha-pdv-total">Multa actual: ' + dinero(item.multa) + ' · Monto exonerado simulado: ' + dinero(item.exonerado) + ' · Multa restante: ' + dinero(item.multaRestante) + ' · Costo evitado: ' + dinero(item.evitado) + '</p>' +
      '<details class="brecha-sim-box"><summary>Simular exoneración · ' + numero(item.guias) + ' guías en este PDV</summary>' +
      '<p class="brecha-sim-note">Marca guías penalizables y asigna a cada una un porcentaje de exoneración. El monto exonerado se reflejará en el desglose por tipo de interrupción; el cálculo no modifica el sistema.</p>' +
      '<div class="brecha-sim-tools"><input type="search" class="brecha-sim-search" data-sim-search value="' + escapar(busquedasSimulacion.get(normalizar(item.pdv)) || '') + '" placeholder="Buscar guía, operación o problema"><div class="brecha-sim-actions"><button type="button" data-sim-action="select">Marcar visibles</button><button type="button" data-sim-action="clear-visible">Desmarcar visibles</button></div></div>' +
      '<div class="brecha-sim-bulk"><label>Porcentaje para las guías marcadas visibles <input type="number" min="0" max="100" step="0.01" value="100" data-sim-bulk-percent></label><button type="button" data-sim-action="apply-percent">Aplicar porcentaje</button></div>' +
      '<div data-sim-body></div><div data-sim-pager class="brecha-sim-pager"></div></details></div>';
  }

  function enlazarSimulacion(detallePdv, item) {
    const detail = detallePdv.querySelector('.brecha-sim-box');
    if (!detail || detail.dataset.bound) return;
    detail.dataset.bound = '1';
    detail.addEventListener('toggle', () => { if (detail.open) renderizarListaSimulacion(detail, item); });
    detail.addEventListener('change', event => {
      const checkbox = event.target.closest('input[data-sim-check]');
      if (checkbox) {
        const percent = checkbox.closest('tr').querySelector('[data-sim-percent]');
        if (checkbox.checked) simulacionSeleccionada.set(checkbox.value, Number(percent && percent.value || 100));
        else simulacionSeleccionada.delete(checkbox.value);
        renderizarEstadisticasInterrupciones(estadisticasRegistros);
        return;
      }
      const percentInput = event.target.closest('input[data-sim-percent]');
      if (!percentInput) return;
      const row = percentInput.closest('tr');
      const selected = row && row.querySelector('input[data-sim-check]');
      if (selected && selected.checked) {
        const value = Math.max(0, Math.min(100, Number(percentInput.value) || 0));
        simulacionSeleccionada.set(selected.value, value);
        renderizarEstadisticasInterrupciones(estadisticasRegistros);
      }
    });
    detail.addEventListener('input', event => {
      if (!event.target.matches('[data-sim-search]')) return;
      const key = normalizar(item.pdv);
      busquedasSimulacion.set(key, event.target.value);
      paginasSimulacion.set(key, 1);
      renderizarListaSimulacion(detail, item);
    });
    detail.addEventListener('click', event => {
      const pageButton = event.target.closest('button[data-sim-page]');
      if (pageButton) {
        const key = normalizar(item.pdv);
        paginasSimulacion.set(key, Math.max(1, (paginasSimulacion.get(key) || 1) + Number(pageButton.dataset.simPage)));
        renderizarListaSimulacion(detail, item);
        return;
      }
      const action = event.target.closest('button[data-sim-action]');
      if (!action) return;
      if (action.dataset.simAction === 'apply-percent') {
        const value = Math.max(0, Math.min(100, Number(detail.querySelector('[data-sim-bulk-percent]')?.value) || 0));
        detail.querySelectorAll('input[data-sim-check]:checked:not(:disabled)').forEach(checkbox => simulacionSeleccionada.set(checkbox.value, value));
        renderizarEstadisticasInterrupciones(estadisticasRegistros);
        return;
      }
      detail.querySelectorAll('input[data-sim-check]:not(:disabled)').forEach(checkbox => {
        if (action.dataset.simAction === 'select') {
          checkbox.checked = true;
          const percent = checkbox.closest('tr').querySelector('[data-sim-percent]');
          simulacionSeleccionada.set(checkbox.value, simulacionSeleccionada.has(checkbox.value) ? simulacionSeleccionada.get(checkbox.value) : Number(percent && percent.value || 100));
        } else {
          checkbox.checked = false;
          simulacionSeleccionada.delete(checkbox.value);
        }
      });
      renderizarEstadisticasInterrupciones(estadisticasRegistros);
    });
  }

  function renderizarListaSimulacion(detail, item) {
    const body = detail.querySelector('[data-sim-body]');
    const pager = detail.querySelector('[data-sim-pager]');
    if (!body || !pager) return;
    const query = normalizar(busquedasSimulacion.get(normalizar(item.pdv)) ?? detail.querySelector('[data-sim-search]')?.value ?? '');
    const rows = [...item.registros].sort((a,b) => String(a.guia || '').localeCompare(String(b.guia || ''), 'es', {numeric:true, sensitivity:'base'})).filter(registro => {
      if (!query) return true;
      return normalizar([registro.guia, registro.tipoOperacion, registro.ultimoProblema, registro.tipoEspera].join(' ')).includes(query);
    });
    const pageCount = Math.max(1, Math.ceil(rows.length / SIMULACION_PAGINA));
    const pageKey = normalizar(item.pdv);
    const page = Math.min(pageCount, Math.max(1, paginasSimulacion.get(pageKey) || 1));
    paginasSimulacion.set(pageKey, page);
    const visible = rows.slice((page - 1) * SIMULACION_PAGINA, page * SIMULACION_PAGINA);
    const content = visible.map(registro => {
      const key = claveGuiaPdv(registro);
      const preventivaActual = preventiva(registro);
      const tipo = String(registro.tipoEspera || '').trim() || 'Sin tipo de interrupción';
      const costo = preventivaActual ? 0 : tarifa(registro.tipoEspera ? claveTipo(registro.tipoEspera) : 'SIN_TIPO');
      const checked = simulacionSeleccionada.has(key);
      const percent = checked ? Math.max(0, Math.min(100, Number(simulacionSeleccionada.get(key)) || 0)) : 100;
      return '<tr><td><input type="checkbox" data-sim-check value="' + escapar(key) + '" aria-label="Simular exoneración de guía ' + escapar(registro.guia) + '" ' + (preventivaActual ? 'disabled title="Guía preventiva; no genera multa"' : '') + (checked ? ' checked' : '') + '></td>' +
        '<td>' + escapar(registro.guia || 'Sin guía') + '</td><td>' + escapar(String(registro.tipoOperacion || '').trim() || 'Sin operación') + '</td><td>' + escapar(tipo) + '</td><td>' + escapar(String(registro.ultimoProblema || '').trim() || 'Sin dato') + '</td>' +
        '<td class="brecha-num ' + (preventivaActual ? 'brecha-sim-preventiva' : '') + '">' + (preventivaActual ? 'Preventiva' : dinero(costo)) + '</td>' +
        '<td><input type="number" min="0" max="100" step="0.01" value="' + percent + '" data-sim-percent aria-label="Porcentaje de exoneración simulado para guía ' + escapar(registro.guia) + '" ' + (!checked || preventivaActual ? 'disabled' : '') + '></td>' +
        '<td class="brecha-num brecha-sim-preventiva">' + (preventivaActual ? '—' : dinero(costo * (checked ? percent : 0) / 100)) + '</td></tr>';
    }).join('');
    body.innerHTML = '<div class="brecha-sim-table-wrap"><table class="brecha-sim-table"><thead><tr><th>✓</th><th>Guía</th><th>Operación más reciente</th><th>Tipo de interrupción</th><th>Problema / brecha</th><th>Multa actual</th><th>Exoneración %</th><th>Monto exonerado</th></tr></thead><tbody>' + (content || '<tr><td colspan="8">No hay guías para esta búsqueda.</td></tr>') + '</tbody></table></div>';
    pager.innerHTML = '<button type="button" data-sim-page="-1" ' + (page <= 1 ? 'disabled' : '') + '>Anterior</button><span>Página ' + page + ' de ' + pageCount + ' · ' + numero(rows.length) + ' guías</span><button type="button" data-sim-page="1" ' + (page >= pageCount ? 'disabled' : '') + '>Siguiente</button>';
  }

  function crearFilaEstadisticaPdv(item, abiertosPdv, abiertosSim) {
    const row = document.createElement('tr');
    const filterCell = document.createElement('td');
    if (typeof window.seleccionarCeldaResumenExcel === 'function') {
      const filter = document.createElement('button');
      filter.type = 'button'; filter.className = 'brecha-pdv-filter'; filter.textContent = item.pdv;
      filter.title = 'Filtrar detalle para ' + item.pdv;
      filter.addEventListener('click', () => window.seleccionarCeldaResumenExcel(item.pdv, ''));
      filterCell.appendChild(filter);
    } else filterCell.textContent = item.pdv;
    row.appendChild(filterCell);

    [numero(item.guias), dinero(item.multa), dinero(item.exonerado), dinero(item.multaRestante), dinero(item.evitado)].forEach(value => {
      const cell = document.createElement('td'); cell.className = 'brecha-num'; cell.textContent = value; row.appendChild(cell);
    });
    const detailCell = document.createElement('td');
    const detail = document.createElement('details'); detail.className = 'brecha-pdv-detail';
    detail.dataset.pdvKey = normalizar(item.pdv);
    const summary = document.createElement('summary'); summary.textContent = 'Ver desglose';
    detail.appendChild(summary);
    const content = document.createElement('div'); content.innerHTML = htmlDetallePdv(item); detail.appendChild(content);
    enlazarSimulacion(content, item);
    const sim = content.querySelector('.brecha-sim-box');
    if (sim) sim.dataset.simPdv = normalizar(item.pdv);
    if (abiertosPdv.has(detail.dataset.pdvKey)) detail.open = true;
    if (sim && abiertosSim.has(normalizar(item.pdv))) { sim.open = true; renderizarListaSimulacion(sim, item); }
    detailCell.appendChild(detail); row.appendChild(detailCell);
    return row;
  }

  function agregarChipsGrupo(summary, pares) {
    pares.forEach(([label, value]) => {
      const chip = document.createElement('span');
      chip.className = 'brecha-group-chip';
      chip.textContent = label + ': ' + value;
      summary.appendChild(chip);
    });
  }

  function tablaPdvDeZona(zona, abiertosPdv, abiertosSim) {
    const table = document.createElement('table');
    table.className = 'brecha-group-pdv-table';
    table.innerHTML = '<thead><tr><th>PDV</th><th>Interrupciones<br><small>guías únicas</small></th><th>Multa acumulada</th><th>Monto exonerado<br><small>simulado</small></th><th>Saldo<br><small>simulado</small></th><th>Costo evitado</th><th>Desglose y simulación</th></tr></thead><tbody></tbody>';
    const body = table.querySelector('tbody');
    zona.pdvs.forEach(item => body.appendChild(crearFilaEstadisticaPdv(item, abiertosPdv, abiertosSim)));
    return table;
  }

  function renderizarEstadisticasInterrupciones(registros = registrosActuales()) {
    ensureStatsPanel();
    enlazarControlesEstadisticas();
    estadisticasRegistros = Array.isArray(registros) ? registros : registrosActuales();
    actualizarOpcionesFiltrosEstadisticas(registrosActuales().length ? registrosActuales() : estadisticasRegistros);
    const body = document.getElementById('excelInterruptionStatsBody');
    const foot = document.getElementById('excelInterruptionStatsFoot');
    if (!body || !foot) return;
    const abiertosPdv = new Set([...body.querySelectorAll('.brecha-pdv-detail[open]')].map(detail => detail.dataset.pdvKey));
    const abiertosSim = new Set([...body.querySelectorAll('.brecha-sim-box[open]')].map(detail => detail.dataset.simPdv));
    const managersPrevios = new Set([...body.querySelectorAll('.brecha-group-manager')].map(group => group.dataset.groupKey));
    const managersAbiertos = new Set([...body.querySelectorAll('.brecha-group-manager[open]')].map(group => group.dataset.groupKey));
    const zonasPrevias = new Set([...body.querySelectorAll('.brecha-group-zone')].map(group => group.dataset.groupKey));
    const zonasAbiertas = new Set([...body.querySelectorAll('.brecha-group-zone[open]')].map(group => group.dataset.groupKey));
    const registrosVisibles = filtrarEstadisticas(estadisticasRegistros);
    const filas = resumirPorPdv(registrosVisibles);
    renderizarGraficosEstadisticas(filas);
    renderizarSimulacionOperaciones(registrosVisibles);
    renderizarResumenSimulacion(estadisticasRegistros);
    body.replaceChildren(); foot.replaceChildren();
    if (!filas.length) {
      body.innerHTML = '<tr><td colspan="7">No hay datos que coincidan con los filtros de estadísticas.</td></tr>';
      return;
    }

    const grupos = agruparEstadisticasPorEncargadoZona(filas);
    grupos.forEach(encargado => {
      const groupRow = document.createElement('tr'); groupRow.className = 'brecha-stats-manager-row';
      const cell = document.createElement('td'); cell.colSpan = 7;
      const managerDetails = document.createElement('details');
      managerDetails.className = 'brecha-group-manager'; managerDetails.dataset.groupKey = encargado.key;
      managerDetails.open = managersPrevios.has(encargado.key) ? managersAbiertos.has(encargado.key) : true;
      const managerSummary = document.createElement('summary');
      const managerTitle = document.createElement('span'); managerTitle.className = 'brecha-group-title';
      managerTitle.textContent = 'Encargado · ' + encargado.nombre; managerSummary.appendChild(managerTitle);
      agregarChipsGrupo(managerSummary, [
        ['Zonas', numero(encargado.zonas.length)], ['PDV', numero(encargado.pdvs.length)], ['Guías', numero(encargado.guias)],
        ['Multa', dinero(encargado.multa)], ['Exonerado simulado', dinero(encargado.exonerado)], ['Saldo simulado', dinero(encargado.saldo)], ['Costo evitado', dinero(encargado.evitado)]
      ]);
      managerDetails.appendChild(managerSummary);
      const managerContent = document.createElement('div'); managerContent.className = 'brecha-group-content';

      encargado.zonas.forEach(zona => {
        const zoneDetails = document.createElement('details'); zoneDetails.className = 'brecha-group-zone';
        zoneDetails.dataset.groupKey = encargado.key + '::' + zona.key;
        zoneDetails.open = zonasPrevias.has(zoneDetails.dataset.groupKey) ? zonasAbiertas.has(zoneDetails.dataset.groupKey) : false;
        const zoneSummary = document.createElement('summary');
        const zoneTitle = document.createElement('span'); zoneTitle.className = 'brecha-group-title';
        zoneTitle.textContent = 'Zona · ' + zona.nombre; zoneSummary.appendChild(zoneTitle);
        agregarChipsGrupo(zoneSummary, [
          ['PDV', numero(zona.pdvs.length)], ['Guías', numero(zona.guias)], ['Multa', dinero(zona.multa)],
          ['Exonerado simulado', dinero(zona.exonerado)], ['Saldo simulado', dinero(zona.saldo)], ['Costo evitado', dinero(zona.evitado)]
        ]);
        zoneDetails.appendChild(zoneSummary);
        const zoneContent = document.createElement('div'); zoneContent.className = 'brecha-group-zone-content';
        zoneContent.appendChild(tablaPdvDeZona(zona, abiertosPdv, abiertosSim));
        zoneDetails.appendChild(zoneContent); managerContent.appendChild(zoneDetails);
      });
      managerDetails.appendChild(managerContent); cell.appendChild(managerDetails); groupRow.appendChild(cell); body.appendChild(groupRow);
    });

    const totalGuias = filas.reduce((sum,x) => sum + x.guias, 0);
    const totalMulta = filas.reduce((sum,x) => sum + x.multa, 0);
    const totalExonerado = filas.reduce((sum,x) => sum + x.exonerado, 0);
    const totalSaldo = filas.reduce((sum,x) => sum + x.multaRestante, 0);
    const totalEvitado = filas.reduce((sum,x) => sum + x.evitado, 0);
    const row = document.createElement('tr');
    ['TOTAL · suma por PDV', numero(totalGuias), dinero(totalMulta), dinero(totalExonerado), dinero(totalSaldo), dinero(totalEvitado), ''].forEach((value,index) => {
      const cell = document.createElement('td'); cell.textContent = value;
      if (index > 0 && index < 6) cell.className = 'brecha-num';
      row.appendChild(cell);
    });
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
          renderizarEstadisticasInterrupciones(estadisticasRegistros);
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
        estadisticasRegistros = registrosActuales();
        Object.values(filtrosEstadisticas).forEach(set => set.clear());
        simulacionSeleccionada.clear();
        paginasSimulacion.clear();
        busquedasSimulacion.clear();
        firmaOpcionesEstadisticas = '';
        renderizarCostosBrecha();
        renderizarEstadisticasInterrupciones(estadisticasRegistros);
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
