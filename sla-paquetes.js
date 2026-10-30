(function () {
  "use strict";

  var PAGE_SIZE = 100;
  var DETAIL_COLUMNS = [
    ["guia", "Guía"], ["pdv", "PDV"], ["destino", "Destino · departamento / provincia / distrito"],
    ["zona", "Tipo de zona"], ["traslado", "SLA traslado"], ["reparto", "SLA reparto"],
    ["inicio", "Inicio · hito usado"], ["fin", "Fin · firma / ahora"], ["horas", "Horas totales"],
    ["netas", "Horas desde SLA traslado"], ["precio", "Precio por guía"], ["tarifa", "Tarifa"],
    ["monto", "Monto SLA"], ["clasificacion", "Clasificación"], ["hitos", "Hitos detallados"]
  ];
  var DETAIL_COLUMNS_STORAGE_KEY = "v16-sla-detalle-columnas-v1";
  var state = {
    role: "",
    currentPdv: "",
    rows: [],
    localMonitorRows: null,
    localMonitorFileName: "",
    config: null,
    prices: new Map(),
    priceDrafts: new Map(),
    priceDistricts: [],
    ranges: [
      { orden: 1, desde_horas: 0, hasta_horas: 48, tarifa_porcentaje: 0 },
      { orden: 2, desde_horas: 48, hasta_horas: null, tarifa_porcentaje: 90 }
    ],
    dataset: null,
    zoneRows: [],
    zoneMap: new Map(),
    zoneDistrictMap: new Map(),
    zoneDataset: null,
    zoneMigrationError: "",
    loadedAt: 0,
    loading: false,
    expandedDepartments: new Set(),
    expandedProvinces: new Set(),
    selectedDepartment: "",
    selectedProvince: "",
    selectedDistrict: "",
    selectedClass: "",
    page: 1,
    collapsedClasses: false,
    visibleDetailColumns: null,
    timer: null
  };

  var events = [
    ["fecha_generacion", "Generación del dato"],
    ["salida_hub", "Salida del HUB"],
    ["llegada_cedis", "Llegada al CEDIS"],
    ["salida_cedis", "Salida del CEDIS"],
    ["llegada_pdv", "Llegada al PDV"],
    ["despacho", "Despacho / enrutamiento"],
    ["firma", "Firma / entrega"],
    ["problema", "Registro del problema"],
    ["retorno_almacen", "Retorno al almacén"],
    ["devolucion", "Llegada al almacén de origen"]
  ];

  function byId(id) { return document.getElementById(id); }
  function allDetailColumnKeys() { return DETAIL_COLUMNS.map(function (entry) { return entry[0]; }); }
  function visibleDetailColumnCount() {
    return state.visibleDetailColumns ? state.visibleDetailColumns.size : DETAIL_COLUMNS.length;
  }
  function persistDetailColumns() {
    try { window.localStorage.setItem(DETAIL_COLUMNS_STORAGE_KEY, JSON.stringify(Array.from(state.visibleDetailColumns || allDetailColumnKeys()))); } catch (_) {}
  }
  function updateDetailColumnStatus() {
    var status = byId("slaColumnStatus");
    if (status) status.textContent = visibleDetailColumnCount() + " de " + DETAIL_COLUMNS.length + " columnas visibles";
  }
  function updateDetailColumnPicker() {
    var container = byId("slaColumnChecks");
    if (container) {
      container.innerHTML = DETAIL_COLUMNS.map(function (entry) {
        var checked = !state.visibleDetailColumns || state.visibleDetailColumns.has(entry[0]);
        return '<label><input type="checkbox" data-sla-column="' + entry[0] + '"' + (checked ? ' checked' : '') + ' onchange="SlaPaquetesV2.cambiarColumnaDetalle(\'' + entry[0] + '\',this.checked)"><span>' + escapeHtml(entry[1]) + '</span></label>';
      }).join("");
    }
    updateDetailColumnStatus();
  }
  function loadDetailColumnPreferences() {
    var visible = allDetailColumnKeys();
    try {
      var saved = JSON.parse(window.localStorage.getItem(DETAIL_COLUMNS_STORAGE_KEY) || "null");
      if (Array.isArray(saved)) visible = saved.filter(function (key) { return allDetailColumnKeys().indexOf(key) >= 0; });
    } catch (_) {}
    if (!visible.length) visible = allDetailColumnKeys();
    state.visibleDetailColumns = new Set(visible);
    updateDetailColumnPicker();
    applyDetailColumnVisibility();
  }
  function applyDetailColumnVisibility() {
    if (!state.visibleDetailColumns) return;
    var panel = byId("slaDetallePanel");
    if (!panel) return;
    Array.prototype.forEach.call(panel.querySelectorAll("[data-sla-col]"), function (cell) {
      cell.hidden = !state.visibleDetailColumns.has(cell.getAttribute("data-sla-col"));
    });
    Array.prototype.forEach.call(panel.querySelectorAll(".sla-detail-group-row td, .sla-empty"), function (cell) {
      cell.colSpan = visibleDetailColumnCount();
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-sla-column]"), function (input) {
      input.checked = state.visibleDetailColumns.has(input.getAttribute("data-sla-column"));
    });
    var table = panel.querySelector(".sla-detail-table");
    var columnWidths = { guia: 128, pdv: 90, destino: 185, zona: 95, traslado: 75, reparto: 75, inicio: 145, fin: 145, horas: 102, netas: 102, precio: 115, tarifa: 80, monto: 112, clasificacion: 120, hitos: 105 };
    if (table) table.style.minWidth = Array.from(state.visibleDetailColumns).reduce(function (total, key) { return total + (columnWidths[key] || 90); }, 0) + "px";
    updateDetailColumnStatus();
  }
  function changeDetailColumn(key, visible) {
    if (!state.visibleDetailColumns) state.visibleDetailColumns = new Set(allDetailColumnKeys());
    if (allDetailColumnKeys().indexOf(key) < 0) return;
    if (visible) state.visibleDetailColumns.add(key);
    else if (state.visibleDetailColumns.size > 1) state.visibleDetailColumns.delete(key);
    else state.visibleDetailColumns.add(key);
    persistDetailColumns();
    applyDetailColumnVisibility();
  }
  function showAllDetailColumns() {
    state.visibleDetailColumns = new Set(allDetailColumnKeys());
    persistDetailColumns();
    applyDetailColumnVisibility();
  }
  function safeText(value) { return String(value == null ? "" : value); }
  function escapeHtml(value) {
    return safeText(value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch];
    });
  }
  function keyText(value) {
    return safeText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("es").replace(/[^A-Z0-9]+/g, "").trim();
  }
  function headerText(value) {
    return safeText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("es").replace(/[^A-Z0-9]+/g, "");
  }
  function geoKey(department, province, district) {
    return keyText(department) + "|" + keyText(province) + "|" + keyText(district);
  }
  function showStatus(message, isError) {
    var el = byId("slaEstado");
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "#b42318" : "";
  }
  function showZoneStatus(message, isError) {
    var el = byId("slaZonaEstado");
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "#b42318" : "";
  }
  function api() {
    if (!window.V16GestionSlaApi) throw new Error("No se cargó la conexión del módulo SLA. Actualiza la página.");
    return window.V16GestionSlaApi;
  }
  function normalizeRow(row) {
    var out = Object.assign({}, row);
    events.forEach(function (entry) {
      out[entry[0]] = parseDate(row[entry[0]]);
    });
    out.guia = safeText(row.guia).trim();
    out.pdv = safeText(row.pdv).trim();
    out.departamento = safeText(row.departamento).trim();
    out.provincia = safeText(row.provincia).trim();
    out.distrito = safeText(row.distrito).trim();
    out._departmentKey = keyText(out.departamento) || "SIN DEPARTAMENTO";
    out._provinceKey = out._departmentKey + "|" + (keyText(out.provincia) || "SIN PROVINCIA");
    out._districtKey = out._provinceKey + "|" + (keyText(row._zoneDistrict || out.distrito) || "SIN DISTRITO");
    out._geoKey = row._zoningGeoKey || geoKey(out.departamento, out.provincia, out.distrito);
    out._guideKey = keyText(out.guia) + "|" + keyText(out.pdv);
    return out;
  }
  function parseDate(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number" && isFinite(value)) {
      if (!window.XLSX || !window.XLSX.SSF) return null;
      var parts = window.XLSX.SSF.parse_date_code(value);
      if (!parts || !parts.y || !parts.m || !parts.d) return null;
      return Date.UTC(parts.y, parts.m - 1, parts.d, (parts.H || 0) + 5, parts.M || 0, Math.floor(parts.S || 0));
    }
    if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
    var text = safeText(value).trim();
    if (!text) return null;
    var match = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) {
      var year = Number(match[3]);
      if (year < 100) year += year < 70 ? 2000 : 1900;
      return Date.UTC(year, Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0) + 5, Number(match[5] || 0), Number(match[6] || 0));
    }
    match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0) + 5, Number(match[5] || 0), Number(match[6] || 0));
    var parsed = Date.parse(text);
    return isNaN(parsed) ? null : parsed;
  }
  function formatDate(epoch) {
    if (!epoch) return "—";
    try {
      return new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
      }).format(new Date(epoch));
    } catch (_) { return new Date(epoch).toLocaleString(); }
  }
  function formatDateCompact(epoch) {
    if (!epoch) return "—";
    try {
      return new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false
      }).format(new Date(epoch)).replace(",", "");
    } catch (_) { return new Date(epoch).toLocaleString(); }
  }
  function calc(row, now) {
    var start = null;
    var label = "";
    var fallback = [
      ["llegada_pdv", "Llegada al PDV"],
      ["salida_cedis", "Salida del CEDIS"],
      ["llegada_cedis", "Llegada al CEDIS"],
      ["salida_hub", "Salida del HUB"],
      ["fecha_generacion", "Generación del dato"]
    ];
    for (var i = 0; i < fallback.length; i++) {
      if (row[fallback[i][0]]) { start = row[fallback[i][0]]; label = fallback[i][1]; break; }
    }
    var signed = !!row.firma;
    var end = signed ? row.firma : now;
    var hours = start ? (end - start) / 3600000 : null;
    var zone = state.zoneMap.get(row._geoKey) || null;
    var transferDays = zone && zone.sla_traslado_dias !== null && zone.sla_traslado_dias !== undefined ? Number(zone.sla_traslado_dias) : null;
    var hoursFromTransfer = hours === null || transferDays === null ? null : Math.max(0, hours - transferDays * 24);
    var classification = "SIN_INICIO";
    if (start && hours < 0) classification = "INCONSISTENTE";
    else if (start && !zone) classification = "SIN_ZONIFICACION";
    else if (start && transferDays === null) classification = "SIN_SLA_TRASLADO";
    else if (start) {
      var range = (state.ranges || []).find(function (item) {
        return hoursFromTransfer >= Number(item.desde_horas) && (item.hasta_horas === null || item.hasta_horas === undefined || hoursFromTransfer < Number(item.hasta_horas));
      });
      if (range) classification = "RANGO_" + range.orden;
      else classification = "INCONSISTENTE";
      var price = state.prices.has(row._geoKey) ? state.prices.get(row._geoKey) : null;
      var tariff = range ? Number(range.tarifa_porcentaje) : null;
      var amount = range && tariff === 0 ? 0 : range && price !== null ? Math.round((price * tariff / 100 + Number.EPSILON) * 100) / 100 : null;
      return { start: start, startLabel: label, end: end, signed: signed, hours: hours, hoursFromTransfer: hoursFromTransfer, transferDays: transferDays, zone: zone, classification: classification, range: range || null, tariff: tariff, price: price, amount: amount };
    }
    return { start: start, startLabel: label, end: end, signed: signed, hours: hours, hoursFromTransfer: hoursFromTransfer, transferDays: transferDays, zone: zone, classification: classification, range: null, tariff: null, price: state.prices.has(row._geoKey) ? state.prices.get(row._geoKey) : null, amount: null };
  }
  function classificationLabel(code) {
    var match = safeText(code).match(/^RANGO_(\d+)$/);
    if (match) {
      var range = (state.ranges || []).find(function (item) { return Number(item.orden) === Number(match[1]); });
      return range ? rangeLabel(range) : "Rango " + match[1];
    }
    if (code === "SIN_INICIO") return "Sin fecha de inicio";
    if (code === "INCONSISTENTE") return "Fecha inconsistente";
    if (code === "SIN_FIRMA") return "Sin firma · en curso";
    if (code === "SIN_ZONIFICACION") return "Sin coincidencia en zonificación";
    if (code === "SIN_SLA_TRASLADO") return "SLA traslado pendiente";
    return "Todas";
  }
  function formatMoney(value) {
    if (value === null || value === undefined || !isFinite(Number(value))) return "Pendiente";
    return "S/ " + Number(value).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function formatPrice(value) {
    if (value === null || value === undefined || !isFinite(Number(value))) return "Pendiente";
    return "S/ " + Number(value).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  function rangeLabel(range) {
    var from = Number(range.desde_horas);
    var to = range.hasta_horas === null || range.hasta_horas === undefined || range.hasta_horas === "" ? null : Number(range.hasta_horas);
    var tariff = Number(range.tarifa_porcentaje);
    return to === null ? "≥ " + from + " h netas · Tarifa " + tariff + "%" : from + " ≤ h netas < " + to + " · Tarifa " + tariff + "%";
  }
  function rangeHeaderLabel(range) {
    var from = Number(range.desde_horas);
    var to = range.hasta_horas === null || range.hasta_horas === undefined || range.hasta_horas === "" ? null : Number(range.hasta_horas);
    var tariff = Number(range.tarifa_porcentaje);
    return to === null ? "≥ " + from + " h netas · " + tariff + "%" : from + "–<" + to + " h netas · " + tariff + "%";
  }
  function normalizedRanges(config) {
    var configured = config && Array.isArray(config.rangos) ? config.rangos : [];
    if (configured.length) return configured.map(function (range, index) {
      return {
        orden: index + 1,
        desde_horas: Number(range.desde_horas),
        hasta_horas: range.hasta_horas === null || range.hasta_horas === undefined || range.hasta_horas === "" ? null : Number(range.hasta_horas),
        tarifa_porcentaje: Number(range.tarifa_porcentaje)
      };
    });
    var threshold = Number(config && config.umbral_horas || 48);
    var tariff = Number(config && config.tarifa_porcentaje || 90);
    return [
      { orden: 1, desde_horas: 0, hasta_horas: threshold, tarifa_porcentaje: 0 },
      { orden: 2, desde_horas: threshold, hasta_horas: null, tarifa_porcentaje: tariff }
    ];
  }
  function normalizedPrices(config) {
    var prices = new Map();
    (config && Array.isArray(config.precios) ? config.precios : []).forEach(function (item) {
      var value = item.precio === null || item.precio === undefined || item.precio === "" ? null : Number(item.precio);
      prices.set(geoKey(item.departamento, item.provincia, item.distrito), isFinite(value) ? value : null);
    });
    return prices;
  }
  function updateFilterOptions() {
    var select = byId("slaFiltroClasificacion");
    if (!select) return;
    var current = select.value;
    var options = ['<option value="">Todas las clasificaciones</option>'];
    (state.ranges || []).forEach(function (range) {
      options.push('<option value="RANGO_' + range.orden + '">' + escapeHtml(rangeLabel(range)) + '</option>');
    });
    options.push('<option value="SIN_INICIO">Sin fecha de inicio</option>');
    options.push('<option value="INCONSISTENTE">Fecha inconsistente</option>');
    options.push('<option value="SIN_ZONIFICACION">Sin coincidencia en zonificación</option>');
    options.push('<option value="SIN_SLA_TRASLADO">SLA traslado pendiente</option>');
    options.push('<option value="SIN_FIRMA">Sin firma · en curso</option>');
    select.innerHTML = options.join("");
    if (Array.prototype.some.call(select.options, function (option) { return option.value === current; })) select.value = current;
  }
  function allRows() {
    var now = Date.now();
    return state.rows.map(function (row) { return Object.assign({}, row, { _calc: calc(row, now) }); });
  }
  function controlFilters() {
    return {
      search: safeText(byId("slaBuscar") && byId("slaBuscar").value).trim().toLocaleUpperCase("es"),
      classification: safeText(byId("slaFiltroClasificacion") && byId("slaFiltroClasificacion").value)
    };
  }
  function matchesFilter(row, filters) {
    if (filters.search) {
      var blob = [row.guia, row.pdv, row.departamento, row.provincia, row.distrito].join(" ").toLocaleUpperCase("es");
      if (blob.indexOf(filters.search) < 0) return false;
    }
    if (filters.classification === "SIN_FIRMA") return !row._calc.signed;
    if (filters.classification && row._calc.classification !== filters.classification) return false;
    return true;
  }
  function filteredRows() {
    var filters = controlFilters();
    return allRows().filter(function (row) { return matchesFilter(row, filters); });
  }
  function classCounts(rows) {
    var result = { SIN_INICIO: 0, INCONSISTENTE: 0, SIN_ZONIFICACION: 0, SIN_SLA_TRASLADO: 0, SIN_FIRMA: 0, SIN_PRECIO: 0 };
    (state.ranges || []).forEach(function (range) { result["RANGO_" + range.orden] = 0; });
    rows.forEach(function (row) {
      result[row._calc.classification] = (result[row._calc.classification] || 0) + 1;
      if (!row._calc.signed) result.SIN_FIRMA++;
      if (row._calc.price === null || row._calc.price === undefined) result.SIN_PRECIO++;
    });
    return result;
  }
  function renderCards(rows) {
    var cards = byId("slaResumenCards");
    if (cards) cards.classList.toggle("hidden", !state.dataset);
    if (!state.dataset) return;
    var counts = classCounts(rows);
    if (byId("slaTotalPaquetes")) byId("slaTotalPaquetes").textContent = rows.length.toLocaleString("es-PE");
    var noTarifa = 0, conTarifa = 0;
    (state.ranges || []).forEach(function (range) {
      var count = counts["RANGO_" + range.orden] || 0;
      if (Number(range.tarifa_porcentaje) > 0) conTarifa += count; else noTarifa += count;
    });
    if (byId("slaEnPlazo")) byId("slaEnPlazo").textContent = noTarifa.toLocaleString("es-PE");
    if (byId("slaTarifaAplicada")) byId("slaTarifaAplicada").textContent = conTarifa.toLocaleString("es-PE");
    if (byId("slaSinFirma")) byId("slaSinFirma").textContent = counts.SIN_FIRMA.toLocaleString("es-PE");
    if (byId("slaSinPrecio")) byId("slaSinPrecio").textContent = counts.SIN_PRECIO.toLocaleString("es-PE");
    if (byId("slaSinZona")) byId("slaSinZona").textContent = (counts.SIN_ZONIFICACION + counts.SIN_SLA_TRASLADO).toLocaleString("es-PE");
  }
  function groupRows(rows) {
    var departments = new Map();
    rows.forEach(function (row) {
      var departmentKey = row._departmentKey || "SIN DEPARTAMENTO";
      var department = departments.get(departmentKey);
      if (!department) {
        department = { key: departmentKey, nombre: row.departamento || "Sin departamento", rows: [], provinces: new Map() };
        departments.set(departmentKey, department);
      }
      department.rows.push(row);
      var provinceKey = row._provinceKey || departmentKey + "|SIN PROVINCIA";
      var province = department.provinces.get(provinceKey);
      if (!province) {
        province = { key: provinceKey, nombre: row.provincia || "Sin provincia", rows: [], districts: new Map() };
        department.provinces.set(provinceKey, province);
      }
      province.rows.push(row);
      var districtKey = row._districtKey || provinceKey + "|SIN DISTRITO";
      var district = province.districts.get(districtKey);
      if (!district) {
        district = { key: districtKey, nombre: row.distrito || "Sin distrito", rows: [] };
        province.districts.set(districtKey, district);
      }
      district.rows.push(row);
    });
    return Array.from(departments.values()).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); }).map(function (department) {
      department.provinceList = Array.from(department.provinces.values()).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); }).map(function (province) {
        province.districtList = Array.from(province.districts.values()).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); });
        return province;
      });
      return department;
    });
  }
  function districtRows(rows) {
    var districts = new Map();
    (rows || []).forEach(function (row) {
      if (!row.distrito || row._zoningMatch !== "MATCH") return;
      var key = row._geoKey;
      if (!districts.has(key)) districts.set(key, {
        key: key,
        departamento: row.departamento || "Sin departamento",
        provincia: row.provincia || "Sin provincia",
        distrito: row._zoneDistrict || row.distrito || "Sin distrito"
      });
    });
    return Array.from(districts.values()).sort(function (a, b) {
      return (a.departamento + a.provincia + a.distrito).localeCompare(b.departamento + b.provincia + b.distrito, "es");
    });
  }
  function amountTotal(rows, classCode) {
    var total = 0, priced = 0, matching = 0;
    rows.forEach(function (row) {
      if (row._calc.classification !== classCode) return;
      matching++;
      if (row._calc.amount === null) return;
      total += row._calc.amount; priced++;
    });
    return { total: Math.round((total + Number.EPSILON) * 100) / 100, priced: priced, matching: matching };
  }
  function actionButton(label, departmentKey, provinceKey, districtKey, classification, className, amount) {
    var amountHtml = amount === undefined ? "" : '<small class="sla-count-amount">' + formatMoney(amount) + '</small>';
    return '<button type="button" class="sla-count-link ' + (className || "") + '" data-sla-action="select" data-department="' + encodeURIComponent(departmentKey || "") + '" data-province="' + encodeURIComponent(provinceKey || "") + '" data-district="' + encodeURIComponent(districtKey || "") + '" data-class="' + encodeURIComponent(classification || "") + '" aria-label="Ver ' + escapeHtml(label) + ' paquetes">' + Number(label || 0).toLocaleString("es-PE") + amountHtml + '</button>';
  }
  function countCells(rows, departmentKey, provinceKey, districtKey) {
    var c = classCounts(rows);
    var hidden = state.collapsedClasses ? " hidden" : "";
    var html = '<td class="number">' + actionButton(rows.length, departmentKey, provinceKey, districtKey, "", "") + '</td>';
    (state.ranges || []).forEach(function (range) {
      var code = "RANGO_" + range.orden;
      var total = amountTotal(rows, code);
      var amount = total.matching === 0 || total.priced === total.matching ? total.total : null;
      html += '<td class="number sla-classification-col' + hidden + '">' + actionButton(c[code], departmentKey, provinceKey, districtKey, code, Number(range.tarifa_porcentaje) > 0 ? "sla-bad" : "sla-good", amount) + '</td>';
    });
    html += '<td class="number sla-classification-col' + hidden + '">' + actionButton(c.SIN_INICIO, departmentKey, provinceKey, districtKey, "SIN_INICIO", "sla-open") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + actionButton(c.INCONSISTENTE, departmentKey, provinceKey, districtKey, "INCONSISTENTE", "sla-open") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + actionButton(c.SIN_ZONIFICACION, departmentKey, provinceKey, districtKey, "SIN_ZONIFICACION", "sla-open") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + actionButton(c.SIN_SLA_TRASLADO, departmentKey, provinceKey, districtKey, "SIN_SLA_TRASLADO", "sla-open") + '</td>' +
      '<td class="number">' + actionButton(c.SIN_FIRMA, departmentKey, provinceKey, districtKey, "SIN_FIRMA", "sla-open") + '</td>';
    return html;
  }
  function renderSummary(rows) {
    var tbody = byId("slaResumenBody");
    if (!tbody) return;
    var classHeader = byId("slaClassificationGroup");
    var classHeaders = byId("slaClassificationHeaders");
    var ranges = state.ranges || [];
    if (classHeader) classHeader.colSpan = ranges.length + 4;
    if (classHeaders) {
      classHeaders.innerHTML = ranges.map(function (range) {
        return '<th class="sla-classification-col">' + escapeHtml(rangeHeaderLabel(range)) + '</th>';
      }).join("") + '<th class="sla-classification-col">Sin inicio</th><th class="sla-classification-col">Fecha inconsistente</th><th class="sla-classification-col">Sin zonificación</th><th class="sla-classification-col">SLA traslado pendiente</th>';
    }
    var groups = groupRows(rows);
    if (!groups.length) {
      tbody.innerHTML = '<tr><td colspan="' + (ranges.length + 7) + '" class="sla-empty">No hay paquetes que coincidan con los filtros.</td></tr>';
      return;
    }
    var html = "";
    groups.forEach(function (department) {
      var departmentExpanded = state.expandedDepartments.has(department.key);
      var departmentSelected = state.selectedDepartment === department.key && !state.selectedProvince ? " sla-row-selected" : "";
      html += '<tr class="sla-department-row' + departmentSelected + '"><td><button type="button" class="sla-group-toggle" data-sla-action="toggle-department" data-department="' + encodeURIComponent(department.key) + '" aria-expanded="' + String(departmentExpanded) + '"><span class="sla-arrow">' + (departmentExpanded ? "▾" : "▸") + '</span><span>' + escapeHtml(department.nombre) + '</span></button></td>' + countCells(department.rows, department.key, "", "") + '</tr>';
      if (departmentExpanded) department.provinceList.forEach(function (province) {
        var provinceExpanded = state.expandedProvinces.has(province.key);
        var provinceSelected = state.selectedDepartment === department.key && state.selectedProvince === province.key && !state.selectedDistrict ? " sla-row-selected" : "";
        html += '<tr class="sla-province-row' + provinceSelected + '"><td><button type="button" class="sla-group-toggle" data-sla-action="toggle-province" data-department="' + encodeURIComponent(department.key) + '" data-province="' + encodeURIComponent(province.key) + '" aria-expanded="' + String(provinceExpanded) + '"><span class="sla-arrow">' + (provinceExpanded ? "▾" : "▸") + '</span><span>' + escapeHtml(province.nombre) + '</span></button></td>' + countCells(province.rows, department.key, province.key, "") + '</tr>';
        if (provinceExpanded) province.districtList.forEach(function (district) {
          var districtSelected = state.selectedDistrict === district.key ? " sla-row-selected" : "";
          html += '<tr class="sla-district-row' + districtSelected + '"><td><button type="button" class="sla-detail-link" data-sla-action="select" data-department="' + encodeURIComponent(department.key) + '" data-province="' + encodeURIComponent(province.key) + '" data-district="' + encodeURIComponent(district.key) + '" data-class="">↳ ' + escapeHtml(district.nombre) + '</button></td>' + countCells(district.rows, department.key, province.key, district.key) + '</tr>';
        });
      });
    });
    var totals = classCounts(rows);
    var hidden = state.collapsedClasses ? " hidden" : "";
    html += '<tr class="sla-total-row"><td>TOTAL GENERAL</td><td class="number">' + rows.length.toLocaleString("es-PE") + '</td>';
    ranges.forEach(function (range) {
      var total = amountTotal(rows, "RANGO_" + range.orden);
      var amount = total.matching === 0 || total.priced === total.matching ? total.total : null;
      html += '<td class="number sla-classification-col' + hidden + '">' + actionButton(totals["RANGO_" + range.orden] || 0, "", "", "", "RANGO_" + range.orden, Number(range.tarifa_porcentaje) > 0 ? "sla-bad" : "sla-good", amount) + '</td>';
    });
    html += '<td class="number sla-classification-col' + hidden + '">' + totals.SIN_INICIO.toLocaleString("es-PE") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + totals.INCONSISTENTE.toLocaleString("es-PE") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + totals.SIN_ZONIFICACION.toLocaleString("es-PE") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + totals.SIN_SLA_TRASLADO.toLocaleString("es-PE") + '</td>' +
      '<td class="number">' + totals.SIN_FIRMA.toLocaleString("es-PE") + '</td></tr>';
    tbody.innerHTML = html;
    var status = byId("slaFiltroEstado");
    if (status) status.textContent = rows.length.toLocaleString("es-PE") + " paquetes · " + groups.length.toLocaleString("es-PE") + " departamentos";
  }
  function selectedRows(rows) {
    return rows.filter(function (row) {
      if (state.selectedDepartment && row._departmentKey !== state.selectedDepartment) return false;
      if (state.selectedProvince && row._provinceKey !== state.selectedProvince) return false;
      if (state.selectedDistrict && row._districtKey !== state.selectedDistrict) return false;
      if (state.selectedClass === "SIN_FIRMA") return !row._calc.signed;
      if (state.selectedClass && row._calc.classification !== state.selectedClass) return false;
      return true;
    });
  }
  function renderDetail() {
    var panel = byId("slaDetallePanel");
    var tbody = byId("slaDetalleBody");
    if (!panel || !tbody) return;
    var filters = controlFilters();
    var rows = allRows().filter(function (row) { return matchesFilter(row, filters); });
    rows = selectedRows(rows).sort(function (a, b) {
      return (a.departamento + a.provincia + a.distrito + a.pdv + a.guia).localeCompare(b.departamento + b.provincia + b.distrito + b.pdv + b.guia, "es");
    });
    var hasSelection = !!(state.selectedDepartment || state.selectedProvince || state.selectedDistrict || state.selectedClass || filters.search || filters.classification);
    panel.classList.toggle("hidden", !hasSelection && !state.showAllDetail);
    if (!hasSelection && !state.showAllDetail) return;
    var title = byId("slaDetalleTitulo");
    if (title) {
      var parts = ["Detalle de paquetes"];
      var location = rows[0] || state.rows.find(function (row) {
        return (!state.selectedDepartment || row._departmentKey === state.selectedDepartment) &&
          (!state.selectedProvince || row._provinceKey === state.selectedProvince) &&
          (!state.selectedDistrict || row._districtKey === state.selectedDistrict);
      });
      if (state.selectedDepartment && location) parts.push(location.departamento || "Sin departamento");
      if (state.selectedProvince && location) parts.push(location.provincia || "Sin provincia");
      if (state.selectedDistrict && location) parts.push(location.distrito || "Sin distrito");
      if (state.selectedClass) parts.push(classificationLabel(state.selectedClass));
      title.textContent = parts.join(" · ");
    }
    var note = byId("slaDetalleFiltro");
    if (note) note.textContent = rows.length.toLocaleString("es-PE") + " guías/PDV, agrupadas en orden Departamento › Provincia › Distrito. Las tarifas usan las horas transcurridas menos el SLA de traslado (en horas); antes de ese umbral se cuentan desde 0. Los paquetes sin firma se recalculan hasta ahora.";
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), pages);
    var from = (state.page - 1) * PAGE_SIZE;
    var pageRows = rows.slice(from, from + PAGE_SIZE);
    if (!pageRows.length) {
      tbody.innerHTML = '<tr><td colspan="' + visibleDetailColumnCount() + '" class="sla-empty">No hay registros para mostrar.</td></tr>';
    } else {
      var locationCounts = new Map();
      rows.forEach(function (row) { locationCounts.set(row._geoKey, (locationCounts.get(row._geoKey) || 0) + 1); });
      var previousLocation = null;
      tbody.innerHTML = pageRows.map(function (row) {
        var c = row._calc;
        var badge = c.range ? (Number(c.range.tarifa_porcentaje) > 0 ? "tarifa" : "sin-tarifa") : c.classification === "SIN_INICIO" ? "sin-inicio" : c.classification === "INCONSISTENTE" ? "inconsistente" : c.classification.indexOf("SIN_") === 0 ? "sin-zona" : "";
        var hours = c.hours === null ? "—" : c.hours.toFixed(2) + " h";
        var effectiveHours = c.hoursFromTransfer === null ? "—" : c.hoursFromTransfer.toFixed(2) + " h";
        var endLabel = c.signed ? "Firma" : "Ahora";
        var destination = '<div class="sla-destination"><strong>' + escapeHtml(row.departamento || "Sin departamento") + '</strong><span>' + escapeHtml(row.provincia || "Sin provincia") + ' › ' + escapeHtml(row.distrito || "Sin distrito") + '</span></div>';
        var milestoneHtml = '<details class="sla-hitos"><summary>Ver hitos</summary><dl>' + events.map(function (entry) {
          var value = row[entry[0]];
          var rendered = value ? formatDateCompact(value) : "—";
          return '<div><dt>' + escapeHtml(entry[1]) + '</dt><dd title="' + escapeHtml(value ? formatDate(value) : "Sin dato") + '">' + escapeHtml(rendered) + '</dd></div>';
        }).join("") + '</dl></details>';
        var locationHtml = "";
        if (previousLocation !== row._geoKey) {
          previousLocation = row._geoKey;
          locationHtml = '<tr class="sla-detail-group-row"><td colspan="' + visibleDetailColumnCount() + '">' + escapeHtml([row.departamento || "Sin departamento",row.provincia || "Sin provincia",row.distrito || "Sin distrito"].join(" › ")) + ' · ' + (locationCounts.get(row._geoKey) || 0).toLocaleString("es-PE") + ' paquetes</td></tr>';
        }
        var detailHtml = '<tr>' +
          '<td data-sla-col="guia" class="sla-guide-cell" title="' + escapeHtml(row.guia) + '">' + escapeHtml(row.guia) + '</td>' +
          '<td data-sla-col="pdv" title="' + escapeHtml(row.pdv) + '">' + escapeHtml(row.pdv) + '</td>' +
          '<td data-sla-col="destino" class="sla-destination-cell" title="' + escapeHtml([row.departamento,row.provincia,row.distrito].filter(Boolean).join(" › ")) + '">' + destination + '</td>' +
          '<td data-sla-col="zona" title="' + escapeHtml(c.zone ? c.zone.tipo_zona || "Sin tipo" : "Sin coincidencia en zonificación") + '">' + escapeHtml(c.zone ? c.zone.tipo_zona || "Sin tipo" : "Sin match") + '</td>' +
          '<td data-sla-col="traslado" class="number" title="SLA de traslado en días">' + (c.zone && c.zone.sla_traslado_dias !== null ? escapeHtml(c.zone.sla_traslado_dias) + ' d' : '—') + '</td>' +
          '<td data-sla-col="reparto" class="number" title="SLA de reparto en días">' + (c.zone && c.zone.sla_reparto_dias !== null ? escapeHtml(c.zone.sla_reparto_dias) + ' d' : '—') + '</td>' +
          '<td data-sla-col="inicio" class="sla-time-cell" title="' + escapeHtml((c.startLabel ? c.startLabel + " · " : "") + formatDate(c.start)) + '"><strong>' + escapeHtml(c.startLabel || "Sin inicio") + '</strong><span>' + escapeHtml(formatDateCompact(c.start)) + '</span></td>' +
          '<td data-sla-col="fin" class="sla-time-cell" title="' + escapeHtml(endLabel + " · " + formatDate(c.end)) + '"><strong>' + escapeHtml(endLabel) + '</strong><span>' + escapeHtml(formatDateCompact(c.end)) + '</span></td>' +
          '<td data-sla-col="horas" class="number" title="Tiempo transcurrido desde el hito de inicio hasta la firma o hasta ahora">' + escapeHtml(hours) + '</td>' +
          '<td data-sla-col="netas" class="number sla-net-hours" title="Horas transcurridas menos (SLA traslado × 24); este valor determina el rango y la tarifa">' + escapeHtml(effectiveHours) + '</td>' +
          '<td data-sla-col="precio" class="number">' + escapeHtml(formatPrice(c.price)) + '</td>' +
          '<td data-sla-col="tarifa" class="number">' + (c.tariff === null ? '—' : escapeHtml(c.tariff.toFixed(2) + "%")) + '</td>' +
          '<td data-sla-col="monto" class="number">' + escapeHtml(formatMoney(c.amount)) + '</td>' +
          '<td data-sla-col="clasificacion"><span class="sla-class-badge ' + badge + '">' + escapeHtml(classificationLabel(c.classification)) + '</span></td>' +
          '<td data-sla-col="hitos">' + milestoneHtml + '</td></tr>';
        return locationHtml + detailHtml;
      }).join("");
    }
    var prev = byId("slaDetallePrev");
    var next = byId("slaDetalleNext");
    var info = byId("slaDetallePaginaInfo");
    if (prev) prev.disabled = state.page <= 1;
    if (next) next.disabled = state.page >= pages;
    if (info) info.textContent = rows.length ? (from + 1).toLocaleString("es-PE") + "–" + Math.min(from + PAGE_SIZE, rows.length).toLocaleString("es-PE") + " de " + rows.length.toLocaleString("es-PE") : "0 resultados";
    applyDetailColumnVisibility();
  }
  function renderAll() {
    updateFilterOptions();
    var rows = filteredRows();
    renderCards(rows);
    renderSummary(rows);
    renderDetail();
    var toggle = byId("slaToggleClasificacion");
    if (toggle) toggle.textContent = state.collapsedClasses ? "Mostrar columnas de clasificación" : "Ocultar columnas de clasificación";
    document.querySelectorAll("#viewSla .sla-classification-col").forEach(function (cell) { cell.hidden = state.collapsedClasses; });
  }
  function applyDataset(data, config) {
    state.rows = resolveMonitoringGeography(data || []).map(normalizeRow);
    state.config = config || state.config || { umbral_horas: 48, tarifa_porcentaje: 90 };
    state.ranges = normalizedRanges(state.config);
    state.prices = normalizedPrices(state.config);
    state.priceDrafts = new Map();
    state.priceDistricts = districtRows(state.rows);
    renderPriceEditor();
  }
  async function loadAllPages() {
    var rows = [];
    var cursor = 0;
    var dataset = null;
    for (;;) {
      var page = await api().ejecutar("listar", { despues_id: cursor, limite: 1000 });
      if (page && page.dataset) dataset = page.dataset;
      var batch = Array.isArray(page && page.filas) ? page.filas : [];
      rows = rows.concat(batch);
      var next = Number(page && page.siguiente_id || cursor);
      if (batch.length < 1000 || next <= cursor) break;
      cursor = next;
      showStatus("Cargando paquetes SLA… " + rows.length.toLocaleString("es-PE") + " filas", false);
      if (rows.length > 100000) throw new Error("La carga supera el límite de lectura del módulo.");
    }
    return { rows: rows, dataset: dataset };
  }
  function normalizeZone(row) {
    var out = {
      departamento: safeText(row.departamento).trim(),
      provincia: safeText(row.provincia).trim(),
      distrito: safeText(row.distrito).trim(),
      tipo_zona: safeText(row.tipo_zona).trim(),
      sla_traslado_dias: row.sla_traslado_dias === null || row.sla_traslado_dias === undefined || row.sla_traslado_dias === "" ? null : Number(row.sla_traslado_dias),
      sla_reparto_dias: row.sla_reparto_dias === null || row.sla_reparto_dias === undefined || row.sla_reparto_dias === "" ? null : Number(row.sla_reparto_dias)
    };
    out._geoKey = geoKey(out.departamento, out.provincia, out.distrito);
    return out;
  }
  function applyZonification(rows, dataset) {
    state.zoneRows = (rows || []).map(normalizeZone);
    state.zoneMap = new Map();
    state.zoneDistrictMap = new Map();
    state.zoneRows.forEach(function (row) {
      state.zoneMap.set(row._geoKey, row);
      var districtKey = keyText(row.distrito);
      if (!districtKey) return;
      var candidates = state.zoneDistrictMap.get(districtKey) || [];
      if (!candidates.some(function (candidate) { return candidate._geoKey === row._geoKey; })) candidates.push(row);
      state.zoneDistrictMap.set(districtKey, candidates);
    });
    state.zoneDataset = dataset || null;
    state.zoneMigrationError = "";
    showZoneStatus(state.zoneDataset ? "Zonificación activa: " + safeText(state.zoneDataset.archivo || "Excel") + " · " + state.zoneRows.length.toLocaleString("es-PE") + " distritos." : "Aún no se cargó la zonificación.", false);
  }
  function resolveMonitoringGeography(rows) {
    var districtAliases = {
      SAPALLANCA: "SAPALLANGA",
      SANJUANDEYSCOS: "SAN JUAN DE ISCOS",
      RAYMONDI: "RAIMONDI"
    };
    return (rows || []).map(function (source) {
      var row = Object.assign({}, source);
      var district = safeText(row.distrito).trim();
      var districtKey = keyText(district);
      var lookupDistrict = districtAliases[districtKey] || district;
      var matches = state.zoneDistrictMap.get(keyText(lookupDistrict)) || [];
      row.departamento = "";
      row.provincia = "";
      row.distrito = district;
      if (matches.length === 1) {
        row.departamento = matches[0].departamento;
        row.provincia = matches[0].provincia;
        row._zoneDistrict = matches[0].distrito;
        row._zoningGeoKey = matches[0]._geoKey;
        row._zoningMatch = "MATCH";
      } else if (matches.length > 1) {
        row._zoningMatch = "AMBIGUOUS";
      } else {
        row._zoningMatch = "MISSING";
      }
      return row;
    });
  }
  async function loadAllZonification() {
    var rows = [];
    var cursor = 0;
    var dataset = null;
    for (;;) {
      var page = await api().zonificacion("listar", { despues_id: cursor, limite: 1000 });
      if (page && page.dataset) dataset = page.dataset;
      var batch = Array.isArray(page && page.filas) ? page.filas : [];
      rows = rows.concat(batch);
      var next = Number(page && page.siguiente_id || cursor);
      if (batch.length < 1000 || next <= cursor) break;
      cursor = next;
      if (rows.length > 50000) throw new Error("La zonificación supera el límite de lectura del módulo.");
    }
    return { rows: rows, dataset: dataset };
  }
  async function alAbrir(force) {
    if (state.loading) return;
    if (!force && state.loadedAt && Date.now() - state.loadedAt < 20000) { renderAll(); return; }
    state.loading = true;
    showStatus("Consultando parámetros y archivo SLA…", false);
    try {
      var config = await api().ejecutar("config", {});
      state.config = config || { umbral_horas: 48, tarifa_porcentaje: 90 };
      state.ranges = normalizedRanges(state.config);
      if (state.role !== "PDV") renderRangeEditor(state.ranges);
      var isPdv = state.role === "PDV";
      var loaded = await Promise.all([isPdv ? Promise.resolve({ rows: [], dataset: null }) : loadAllPages(), loadAllZonification().catch(function (error) {
        state.zoneMigrationError = error && error.message || String(error);
        return { rows: [], dataset: null };
      })]);
      var result = loaded[0];
      applyZonification(loaded[1].rows, loaded[1].dataset);
      if (isPdv) {
        applyDataset(state.localMonitorRows || [], config);
        state.dataset = state.localMonitorRows ? { local: true, archivo: state.localMonitorFileName, filas: state.rows.length } : null;
        if (state.localMonitorRows) {
          var localConfig = await api().ejecutar("config_pdv", {
            distritos: state.priceDistricts.map(function (item) { return { departamento: item.departamento, provincia: item.provincia, distrito: item.distrito }; })
          });
          state.prices = normalizedPrices(localConfig);
          state.config = Object.assign({}, config, { precios: localConfig && localConfig.precios || [] });
        }
      } else {
        applyDataset(result.rows, config);
        state.dataset = result.dataset || config.dataset || null;
      }
      state.loadedAt = Date.now();
      state.page = 1;
      if (!state.dataset) {
        state.rows = [];
        showStatus(isPdv ? "Carga el Excel de monitoreo para consultar únicamente el PDV de esta sesión. La información se procesa en este navegador y no se guarda ni comparte." : "Aún no hay archivo de monitoreo. " + (state.zoneDataset ? "Zonificación activa: " + state.zoneRows.length.toLocaleString("es-PE") + " distritos." : state.zoneMigrationError ? "Ejecuta una vez supabase_gestion_v2_sla_zonificacion.sql para habilitar el archivo de zonificación." : "Falta cargar zonificación y monitoreo."), false);
      } else {
        var globalCount = Number(state.dataset.filas || 0);
        var visibleCount = state.rows.length;
        var zoneSummary = state.zoneDataset ? " · Zonificación: " + safeText(state.zoneDataset.archivo || "Excel") + " · " + state.zoneRows.length.toLocaleString("es-PE") + " distritos" : " · Sin zonificación activa";
        var localMatch = state.rows.filter(function (row) { return row._zoningMatch === "MATCH"; }).length;
        var localAmbiguous = state.rows.filter(function (row) { return row._zoningMatch === "AMBIGUOUS"; }).length;
        var localMissing = state.rows.filter(function (row) { return row._zoningMatch === "MISSING"; }).length;
        var zoningSummary = localAmbiguous || localMissing ? " · Zonificación: " + localMatch.toLocaleString("es-PE") + " con match, " + localAmbiguous.toLocaleString("es-PE") + " ambiguos, " + localMissing.toLocaleString("es-PE") + " sin coincidencia" : "";
        showStatus((isPdv ? "Archivo local: " : "Archivo activo: ") + safeText(state.dataset.archivo || "Monitoreo") + " · " + visibleCount.toLocaleString("es-PE") + " paquetes" + (isPdv ? " de " + safeText(state.currentPdv) + " · No guardado ni compartido" : globalCount > visibleCount ? " de " + globalCount.toLocaleString("es-PE") + " en la carga" : "") + zoneSummary + (state.zoneMigrationError ? " · Ejecuta supabase_gestion_v2_sla_zonificacion.sql para activar la zonificación." : "."), false);
      }
      renderAll();
    } catch (error) {
      showStatus("No se pudo cargar el módulo SLA. Verifica que ejecutaste supabase_gestion_v2_sla_paquetes.sql. Detalle: " + (error && error.message || error), true);
    } finally { state.loading = false; }
  }
  function setRole(role, pdv) {
    state.role = safeText(role).toUpperCase();
    state.currentPdv = safeText(pdv).trim();
    var admin = byId("slaAdminTools");
    if (admin) admin.classList.toggle("hidden", state.role !== "ADMINISTRADOR");
    var local = byId("slaPdvTools");
    if (local) local.classList.toggle("hidden", state.role !== "PDV");
  }
  function renderPriceEditor() {
    var body = byId("slaPreciosEditor");
    if (!body) return;
    var query = safeText(byId("slaPrecioBuscar") && byId("slaPrecioBuscar").value).trim().toLocaleUpperCase("es");
    var rows = state.priceDistricts.filter(function (item) {
      return !query || [item.departamento,item.provincia,item.distrito].join(" ").toLocaleUpperCase("es").indexOf(query) >= 0;
    });
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="sla-empty">No hay distritos disponibles para editar.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (item) {
      var value = state.priceDrafts.has(item.key) ? state.priceDrafts.get(item.key) : state.prices.get(item.key);
      return '<tr><td>' + escapeHtml(item.departamento) + '</td><td>' + escapeHtml(item.provincia) + '</td><td>' + escapeHtml(item.distrito) + '</td><td><input type="number" min="0" max="9999999999.9999" step="0.0001" inputmode="decimal" data-price-key="' + encodeURIComponent(item.key) + '" aria-label="Precio por guía de ' + escapeHtml(item.distrito) + '" placeholder="Sin definir" value="' + (value === null || value === undefined ? "" : escapeHtml(value)) + '"></td></tr>';
    }).join("");
  }
  function filtrarPrecios() { renderPriceEditor(); }
  function updatePriceDraft(event) {
    var input = event.target.closest("input[data-price-key]");
    if (!input) return;
    var key = decodeURIComponent(input.getAttribute("data-price-key") || "");
    var value = input.value.trim();
    state.priceDrafts.set(key, value === "" ? null : Number(value));
    renderAll();
  }
  async function guardarPrecios() {
    if (state.role !== "ADMINISTRADOR") { showStatus("Solo el administrador puede cambiar el precio por distrito.", true); return; }
    if (!state.priceDrafts.size) { showStatus("No hay cambios de precio por guardar.", false); return; }
    var districtByKey = new Map(state.priceDistricts.map(function (item) { return [item.key, item]; }));
    var prices = Array.from(state.priceDrafts.entries()).map(function (entry) {
      var item = districtByKey.get(entry[0]);
      var amount = entry[1];
      return item ? { departamento: item.departamento, provincia: item.provincia, distrito: item.distrito, precio: entry[1] } : null;
    }).filter(Boolean);
    var invalidPrice = prices.find(function (item) {
      var amount = item.precio;
      return amount !== null && (!isFinite(amount) || amount < 0 || amount > 9999999999.9999 || Math.abs(amount * 10000 - Math.round(amount * 10000)) > 0.000001);
    });
    if (invalidPrice) { showStatus("Cada precio debe ser mayor o igual a cero y tener hasta 4 decimales.", true); return; }
    var button = byId("slaGuardarPrecios");
    if (button) button.disabled = true;
    try {
      await api().ejecutar("guardar_precios", { precios: prices });
      state.config = await api().ejecutar("config", {});
      state.ranges = normalizedRanges(state.config);
      state.prices = normalizedPrices(state.config);
      state.priceDrafts.clear();
      renderPriceEditor();
      renderAll();
      showStatus("Precios por distrito guardados y compartidos.", false);
    } catch (error) {
      showStatus("No se pudieron guardar los precios. Detalle: " + (error && error.message || error), true);
    } finally { if (button) button.disabled = false; }
  }
  function readRangeEditor() {
    var body = byId("slaRangesEditor");
    if (!body) return [];
    return Array.prototype.map.call(body.querySelectorAll("tr"), function (row, index) {
      var get = function (field) { return row.querySelector('[data-range-field="' + field + '"]').value.trim(); };
      var from = get("desde");
      var to = get("hasta");
      var tariff = get("tarifa");
      return {
        orden: index + 1,
        desde_horas: from === "" ? null : Number(from),
        hasta_horas: to === "" ? null : Number(to),
        tarifa_porcentaje: tariff === "" ? null : Number(tariff)
      };
    });
  }
  function renderRangeEditor(ranges) {
    var body = byId("slaRangesEditor");
    if (!body) return;
    var values = ranges && ranges.length ? ranges : state.ranges;
    body.innerHTML = values.map(function (range, index) {
      var to = range.hasta_horas === null || range.hasta_horas === undefined ? "" : safeText(range.hasta_horas);
      return '<tr><td><input type="number" min="0" max="100000" step="0.01" data-range-field="desde" aria-label="Hora inicial del rango ' + (index + 1) + '" value="' + escapeHtml(range.desde_horas) + '"></td>' +
        '<td><input type="number" min="0" max="100000" step="0.01" data-range-field="hasta" aria-label="Hora final del rango ' + (index + 1) + '" placeholder="Sin límite" value="' + escapeHtml(to) + '"></td>' +
        '<td><input type="number" min="0" max="100" step="0.01" data-range-field="tarifa" aria-label="Tarifa porcentual del rango ' + (index + 1) + '" value="' + escapeHtml(range.tarifa_porcentaje) + '"></td>' +
        '<td><button type="button" class="danger sla-remove-range" onclick="SlaPaquetesV2.quitarRango(' + index + ')" aria-label="Eliminar rango ' + (index + 1) + '" ' + (values.length <= 1 ? "disabled" : "") + '>Quitar</button></td></tr>';
    }).join("");
  }
  function validateRanges(ranges) {
    if (!ranges.length || ranges.length > 20) return "Configura entre 1 y 20 rangos.";
    if (ranges[0].desde_horas !== 0) return "El primer rango debe comenzar en 0 horas.";
    for (var i = 0; i < ranges.length; i++) {
      var range = ranges[i];
      if (!isFinite(range.desde_horas) || range.desde_horas < 0 || range.desde_horas > 100000) return "Revisa la hora inicial del rango " + (i + 1) + ".";
      if (!isFinite(range.tarifa_porcentaje) || range.tarifa_porcentaje < 0 || range.tarifa_porcentaje > 100) return "La tarifa del rango " + (i + 1) + " debe estar entre 0 y 100%.";
      if (i > 0 && range.desde_horas !== ranges[i - 1].hasta_horas) return "Los rangos deben ser continuos y no solaparse. El rango " + (i + 1) + " debe iniciar donde termina el anterior.";
      if (i < ranges.length - 1) {
        if (!isFinite(range.hasta_horas) || range.hasta_horas <= range.desde_horas) return "Cada rango intermedio necesita un límite final mayor a su inicio.";
      } else if (range.hasta_horas !== null) return "Deja vacío el límite final del último rango para cubrir las horas mayores.";
      if (range.hasta_horas !== null && (!isFinite(range.hasta_horas) || range.hasta_horas > 100000 || range.hasta_horas <= range.desde_horas)) return "Revisa el límite final del rango " + (i + 1) + ".";
    }
    return "";
  }
  function agregarRango() {
    var ranges = readRangeEditor();
    if (!ranges.length) ranges = state.ranges.map(function (x) { return Object.assign({}, x); });
    if (ranges.length >= 20) { showStatus("Se permiten hasta 20 rangos.", true); return; }
    var last = ranges[ranges.length - 1];
    if (!isFinite(last.desde_horas) || last.desde_horas < 0 || !isFinite(last.tarifa_porcentaje)) {
      showStatus("Completa las horas y la tarifa antes de agregar otro rango.", true); return;
    }
    if (last.hasta_horas === null) {
      var boundary = last.desde_horas + 24;
      if (boundary > 100000) { showStatus("El rango supera el máximo de horas permitido.", true); return; }
      last.hasta_horas = boundary;
      ranges.push({ orden: ranges.length + 1, desde_horas: boundary, hasta_horas: null, tarifa_porcentaje: last.tarifa_porcentaje });
    } else {
      if (!isFinite(last.hasta_horas) || last.hasta_horas <= last.desde_horas) { showStatus("Corrige el límite del último rango antes de agregar otro.", true); return; }
      ranges.push({ orden: ranges.length + 1, desde_horas: last.hasta_horas, hasta_horas: null, tarifa_porcentaje: last.tarifa_porcentaje });
    }
    ranges.forEach(function (range, index) { range.orden = index + 1; });
    renderRangeEditor(ranges);
  }
  function quitarRango(index) {
    var ranges = readRangeEditor();
    if (ranges.length <= 1) { showStatus("Debe quedar al menos un rango.", true); return; }
    var removed = ranges.splice(Number(index), 1)[0];
    if (!removed) return;
    var cursor = 0;
    ranges.forEach(function (range, i) {
      var width = range.hasta_horas === null ? null : range.hasta_horas - range.desde_horas;
      range.orden = i + 1;
      range.desde_horas = cursor;
      range.hasta_horas = i === ranges.length - 1 ? null : cursor + (isFinite(width) && width > 0 ? width : 24);
      if (range.hasta_horas !== null) cursor = range.hasta_horas;
    });
    renderRangeEditor(ranges);
  }
  function applyFilters() {
    state.page = 1;
    renderAll();
  }
  function clearFilters() {
    if (byId("slaBuscar")) byId("slaBuscar").value = "";
    if (byId("slaFiltroClasificacion")) byId("slaFiltroClasificacion").value = "";
    state.selectedDepartment = "";
    state.selectedProvince = "";
    state.selectedDistrict = "";
    state.selectedClass = "";
    state.showAllDetail = false;
    state.page = 1;
    renderAll();
  }
  function clearSelection() {
    state.selectedDepartment = "";
    state.selectedProvince = "";
    state.selectedDistrict = "";
    state.selectedClass = "";
    state.showAllDetail = true;
    state.page = 1;
    renderAll();
  }
  function expandAll() {
    filteredRows().forEach(function (row) {
      state.expandedDepartments.add(row._departmentKey);
      state.expandedProvinces.add(row._provinceKey);
    });
    renderAll();
  }
  function collapseAll() { state.expandedDepartments.clear(); state.expandedProvinces.clear(); renderAll(); }
  function toggleClasses() { state.collapsedClasses = !state.collapsedClasses; renderAll(); }
  function changePage(delta) { state.page += Number(delta || 0); renderDetail(); }
  function handleSummaryClick(event) {
    var button = event.target.closest("[data-sla-action]");
    if (!button) return;
    var action = button.getAttribute("data-sla-action");
    var department = decodeURIComponent(button.getAttribute("data-department") || "");
    var province = decodeURIComponent(button.getAttribute("data-province") || "");
    if (action === "toggle-department") {
      if (state.expandedDepartments.has(department)) state.expandedDepartments.delete(department); else state.expandedDepartments.add(department);
      renderSummary(filteredRows());
      return;
    }
    if (action === "toggle-province") {
      if (state.expandedProvinces.has(province)) state.expandedProvinces.delete(province); else state.expandedProvinces.add(province);
      renderSummary(filteredRows());
      return;
    }
    state.selectedDepartment = department;
    state.selectedProvince = province;
    state.selectedDistrict = decodeURIComponent(button.getAttribute("data-district") || "");
    state.selectedClass = decodeURIComponent(button.getAttribute("data-class") || "");
    if (byId("slaFiltroClasificacion")) byId("slaFiltroClasificacion").value = "";
    state.page = 1;
    state.showAllDetail = false;
    renderAll();
    var panel = byId("slaDetallePanel");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function findHeaderIndex(headers, candidates) {
    var keys = candidates.map(headerText);
    for (var i = 0; i < headers.length; i++) if (keys.indexOf(headerText(headers[i])) >= 0) return i;
    return -1;
  }
  function parseWorkbook(file) {
    return file.arrayBuffer().then(function (buffer) {
      if (!window.XLSX) throw new Error("No está disponible el lector de Excel.");
      var wb = window.XLSX.read(buffer, { type: "array", cellDates: false, raw: true });
      var name = wb.SheetNames && wb.SheetNames[0];
      if (!name) throw new Error("El archivo no contiene hojas.");
      var sheet = wb.Sheets[name];
      var matrix = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
      var headerRow = -1;
      var scoreBest = -1;
      for (var r = 0; r < Math.min(matrix.length, 35); r++) {
        var rowKeys = matrix[r].map(headerText);
        var score = 0;
        if (rowKeys.some(function (x) { return x.indexOf("NUMERODEGUIA") >= 0 || x === "GUIA" || x.indexOf("TRACKINGNUMBER") >= 0; })) score += 4;
        if (rowKeys.some(function (x) { return x.indexOf("PDV") >= 0 || x.indexOf("PUNTODEVENTA") >= 0; })) score += 3;
        if (rowKeys.some(function (x) { return x.indexOf("LLEGADAALPDV") >= 0; })) score += 3;
        if (rowKeys.some(function (x) { return x.indexOf("HORAFIRMA") >= 0 || x.indexOf("FIRMA") >= 0; })) score += 2;
        if (score > scoreBest) { scoreBest = score; headerRow = r; }
      }
      if (headerRow < 0 || scoreBest < 5) throw new Error("No se encontró la fila de encabezados del monitoreo. Verifica que sea el archivo de exportación de guías.");
      var headers = matrix[headerRow];
      var columns = {
        guia: findHeaderIndex(headers, ["Número de Guía", "Número de Guia", "Guía", "Tracking Number", "Tracking Number / 运单号"]),
        pdv: findHeaderIndex(headers, ["PDV de destino", "PDV destino", "Punto de venta de destino", "PDV"]),
        distrito: findHeaderIndex(headers, ["Colonia de destino", "Distrito de destino"]),
        fecha_generacion: findHeaderIndex(headers, ["Fecha de generación de datos", "Fecha de generacion de datos", "Tiempo de entrada al sistema"]),
        salida_hub: findHeaderIndex(headers, ["Hora de salida del HUB", "Salida del HUB hacia el Cedis/Pdv", "Salida del HUB hacia el CEDIS/PDV"]),
        llegada_cedis: findHeaderIndex(headers, ["Tiempo de llegada al CEDIS", "Llegada del paquete al cedis"]),
        salida_cedis: findHeaderIndex(headers, ["Tiempo de salida del CEDIS", "Salida del paquete del cedis hacia el PDV"]),
        llegada_pdv: findHeaderIndex(headers, ["Hora de llegada al PDV", "Tiempo de llegada al PDV", "Llegada del paquete al PDV"]),
        despacho: findHeaderIndex(headers, ["Tiempo de despacho", "Escaneo de enrutamiento"]),
        firma: findHeaderIndex(headers, ["Hora de firma", "Fecha y hora del escaneo de entrega al cliente"]),
        problema: findHeaderIndex(headers, ["Hora de registro del problema", "Escaneo de problema que impide la entrega"]),
        retorno_almacen: findHeaderIndex(headers, ["Hora de volver al almacén", "Hora de volver al almacen", "Escaneo de retorno del paquete"]),
        devolucion: findHeaderIndex(headers, ["Tiempo de devolución", "Tiempo de devolucion", "Tiempo de llegada al almacén de origen"])
      };
      var fallback = { guia: 0, pdv: 3, distrito: 9, fecha_generacion: 10, salida_hub: 12, llegada_cedis: 14, salida_cedis: 15, llegada_pdv: 16, despacho: 17, firma: 22, problema: 24, retorno_almacen: 26, devolucion: 28 };
      Object.keys(fallback).forEach(function (key) { if (columns[key] < 0) columns[key] = fallback[key]; });
      var records = [];
      var unique = new Map();
      for (var i = headerRow + 1; i < matrix.length; i++) {
        var row = matrix[i];
        var guide = safeText(row[columns.guia]).trim();
        var pdv = safeText(row[columns.pdv]).trim();
        if (!guide || !pdv) continue;
        var record = { guia: guide, pdv: pdv };
        ["distrito","fecha_generacion","salida_hub","llegada_cedis","salida_cedis","llegada_pdv","despacho","firma","problema","retorno_almacen","devolucion"].forEach(function (key) {
          var value = row[columns[key]];
          if (key.indexOf("fecha_") === 0 || ["salida_hub","llegada_cedis","salida_cedis","llegada_pdv","despacho","firma","problema","retorno_almacen","devolucion"].indexOf(key) >= 0) {
            record[key] = parseDate(value);
            if (record[key] !== null) record[key] = new Date(record[key]).toISOString();
          } else record[key] = safeText(value).trim();
        });
        var k = keyText(guide) + "|" + keyText(pdv);
        unique.set(k, record);
      }
      records = Array.from(unique.values());
      if (!records.length) throw new Error("No se encontraron filas con guía y PDV.");
      if (records.length > 100000) throw new Error("El archivo supera el máximo de 100,000 guías por carga.");
      return { rows: records, file: file, sheet: name };
    });
  }
  function parseSlaDays(value, rowNumber, columnName) {
    if (value === null || value === undefined || safeText(value).trim() === "") return null;
    var parsed = typeof value === "number" ? value : Number(safeText(value).trim().replace(",", "."));
    if (!isFinite(parsed) || parsed < 0 || parsed > 365) throw new Error("El valor de " + columnName + " de la fila " + rowNumber + " debe estar entre 0 y 365 días.");
    return Math.round((parsed + Number.EPSILON) * 100) / 100;
  }
  function parseZonificationFile(file) {
    return file.arrayBuffer().then(function (buffer) {
      if (!window.XLSX) throw new Error("No está disponible el lector de Excel.");
      var workbook = window.XLSX.read(buffer, { type: "array", cellDates: false, raw: true });
      var sheetName = workbook.SheetNames && workbook.SheetNames[0];
      if (!sheetName) throw new Error("El archivo no contiene hojas.");
      var matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true, blankrows: false });
      var headerRow = -1;
      var columns = null;
      for (var r = 0; r < Math.min(matrix.length, 35); r++) {
        var headers = matrix[r];
        var found = {
          departamento: findHeaderIndex(headers, ["Departamento"]),
          provincia: findHeaderIndex(headers, ["Provincia"]),
          distrito: findHeaderIndex(headers, ["Distrito"]),
          tipo_zona: findHeaderIndex(headers, ["Tipo de zona", "Tipo zona"]),
          sla_traslado_dias: findHeaderIndex(headers, ["SLA traslado (días)", "SLA traslado dias", "SLA traslado"]),
          sla_reparto_dias: findHeaderIndex(headers, ["SLA reparto (días)", "SLA reparto dias", "SLA reparto"])
        };
        if (found.departamento >= 0 && found.provincia >= 0 && found.distrito >= 0 && found.tipo_zona >= 0 && found.sla_traslado_dias >= 0 && found.sla_reparto_dias >= 0) {
          headerRow = r;
          columns = found;
          break;
        }
      }
      if (!columns) throw new Error("No se encontraron las columnas Departamento, Provincia, Distrito, Tipo de zona, SLA traslado (días) y SLA reparto (días) en la primera hoja.");
      var unique = new Map();
      for (var i = headerRow + 1; i < matrix.length; i++) {
        var row = matrix[i];
        var department = safeText(row[columns.departamento]).trim();
        var province = safeText(row[columns.provincia]).trim();
        var district = safeText(row[columns.distrito]).trim();
        if (!department && !province && !district) continue;
        if (!department || !province || !district) throw new Error("La fila " + (i + 1) + " tiene incompleta la ubicación Departamento / Provincia / Distrito.");
        var item = {
          departamento: department,
          provincia: province,
          distrito: district,
          tipo_zona: safeText(row[columns.tipo_zona]).trim(),
          sla_traslado_dias: parseSlaDays(row[columns.sla_traslado_dias], i + 1, "SLA traslado"),
          sla_reparto_dias: parseSlaDays(row[columns.sla_reparto_dias], i + 1, "SLA reparto")
        };
        var key = geoKey(department, province, district);
        var previous = unique.get(key);
        if (previous) {
          var same = keyText(previous.tipo_zona) === keyText(item.tipo_zona) && previous.sla_traslado_dias === item.sla_traslado_dias && previous.sla_reparto_dias === item.sla_reparto_dias;
          if (!same) throw new Error("Hay dos asignaciones distintas para " + department + " / " + province + " / " + district + ". Corrige los duplicados antes de cargar.");
          continue;
        }
        unique.set(key, item);
      }
      var rows = Array.from(unique.values());
      if (!rows.length) throw new Error("No se encontraron distritos con SLA en el archivo.");
      if (rows.length > 50000) throw new Error("El archivo supera el máximo de 50,000 distritos por carga.");
      return { rows: rows, file: file, sheet: sheetName };
    });
  }
  function catalogMaps(catalog) {
    var map = new Map();
    (catalog || []).forEach(function (item) {
      var pdv = safeText(item.pdv).trim();
      var value = { pdv: pdv, area: safeText(item.area), region: safeText(item.region) };
      [pdv].concat(Array.isArray(item.aliases) ? item.aliases : []).forEach(function (alias) {
        var k = keyText(alias);
        if (k && !map.has(k)) map.set(k, value);
      });
    });
    return map;
  }
  async function importarArchivo() {
    var isPdv = state.role === "PDV";
    if (!isPdv && state.role !== "ADMINISTRADOR") { showStatus("Solo el administrador puede cargar el archivo SLA.", true); return; }
    if (isPdv && !state.currentPdv) { showStatus("No se pudo identificar el PDV de esta sesión.", true); return; }
    if (isPdv) {
      if (!state.config) {
        state.config = await api().ejecutar("config", {});
        state.ranges = normalizedRanges(state.config);
      }
      if (!state.zoneRows.length) {
        var zoning = await loadAllZonification();
        applyZonification(zoning.rows, zoning.dataset);
      }
    }
    var input = byId(isPdv ? "slaPdvArchivoInput" : "slaArchivoInput");
    var file = input && input.files && input.files[0];
    if (!file) { showStatus("Selecciona el archivo Excel de monitoreo.", true); return; }
    var button = byId(isPdv ? "slaPdvImportarArchivo" : "slaImportarArchivo");
    var progress = byId(isPdv ? "slaPdvCargaProgreso" : "slaCargaProgreso");
    var uploadId = "";
    if (button) button.disabled = true;
    if (progress) { progress.hidden = false; progress.value = 0; }
    showStatus("Leyendo " + file.name + "…", false);
    try {
      var parsed = await parseWorkbook(file);
      showStatus("Reconociendo PDV y preparando " + parsed.rows.length.toLocaleString("es-PE") + " filas…", false);
      var catalog = await api().catalogo();
      var map = catalogMaps(catalog);
      parsed.rows = parsed.rows.map(function (row) {
        var rawPdv = row.pdv;
        var match = map.get(keyText(rawPdv)) || map.get(keyText(rawPdv.split("|")[0].trim()));
        return Object.assign({}, row, {
          pdv: match ? match.pdv : rawPdv.split("|")[0].trim(),
          area: match ? match.area : "",
          region: match ? match.region : ""
        });
      });
      if (isPdv) {
        var current = map.get(keyText(state.currentPdv));
        var expectedPdv = current ? current.pdv : state.currentPdv;
        parsed.rows = parsed.rows.filter(function (row) { return keyText(row.pdv) === keyText(expectedPdv); });
        if (!parsed.rows.length) throw new Error("El archivo no contiene guías del PDV " + expectedPdv + ". No se cargaron ni guardaron datos.");
        state.localMonitorRows = parsed.rows;
        state.localMonitorFileName = file.name;
        applyDataset(state.localMonitorRows, state.config);
        state.dataset = { local: true, archivo: file.name, filas: state.rows.length };
        var localConfig = await api().ejecutar("config_pdv", {
          distritos: state.priceDistricts.map(function (item) { return { departamento: item.departamento, provincia: item.provincia, distrito: item.distrito }; })
        });
        state.prices = normalizedPrices(localConfig);
        state.config = Object.assign({}, state.config, { precios: localConfig && localConfig.precios || [] });
        state.loadedAt = Date.now();
        state.page = 1;
        state.selectedDepartment = "";
        state.selectedProvince = "";
        state.selectedDistrict = "";
        state.selectedClass = "";
        state.showAllDetail = false;
        if (progress) progress.value = 100;
        renderAll();
        var matched = state.rows.filter(function (row) { return row._zoningMatch === "MATCH"; }).length;
        var ambiguous = state.rows.filter(function (row) { return row._zoningMatch === "AMBIGUOUS"; }).length;
        var missing = state.rows.filter(function (row) { return row._zoningMatch === "MISSING"; }).length;
        showStatus("Archivo procesado solo en este navegador: " + state.rows.length.toLocaleString("es-PE") + " guías de " + expectedPdv + ". No se guardó ni compartió. Zonificación: " + matched.toLocaleString("es-PE") + " con match, " + ambiguous.toLocaleString("es-PE") + " ambiguos, " + missing.toLocaleString("es-PE") + " sin coincidencia.", false);
        return;
      }
      parsed.rows = resolveMonitoringGeography(parsed.rows);
      var start = await api().ejecutar("iniciar_carga", { archivo: file.name, filas: parsed.rows.length });
      uploadId = safeText(start && start.id);
      if (!uploadId) throw new Error("Supabase no devolvió el identificador de carga.");
      var chunkSize = 250;
      for (var i = 0; i < parsed.rows.length; i += chunkSize) {
        var block = parsed.rows.slice(i, i + chunkSize);
        await api().ejecutar("guardar_bloque", { carga_id: uploadId, filas: block });
        if (progress) progress.value = Math.floor(Math.min(95, ((i + block.length) / parsed.rows.length) * 95));
        showStatus("Subiendo el archivo SLA… " + Math.min(i + block.length, parsed.rows.length).toLocaleString("es-PE") + " de " + parsed.rows.length.toLocaleString("es-PE"), false);
      }
      await api().ejecutar("publicar_carga", { carga_id: uploadId });
      uploadId = "";
      if (progress) progress.value = 100;
      state.loadedAt = 0;
      state.selectedDepartment = "";
      state.selectedProvince = "";
      state.selectedDistrict = "";
      state.selectedClass = "";
      state.showAllDetail = false;
      await alAbrir(true);
      showStatus("Carga publicada: " + parsed.rows.length.toLocaleString("es-PE") + " guías de " + file.name + ".", false);
    } catch (error) {
      if (uploadId) { try { await api().ejecutar("cancelar_carga", { carga_id: uploadId }); } catch (_) {} }
      if (isPdv && state.localMonitorRows) {
        renderAll();
        showStatus("El archivo quedó visible en este navegador y no se guardó ni compartió. No se pudieron leer algunas tarifas compartidas. Detalle: " + (error && error.message || error), true);
      } else {
        showStatus("No se publicó el archivo; la carga activa se conserva. Detalle: " + (error && error.message || error), true);
      }
    } finally {
      if (button) button.disabled = false;
      if (progress) window.setTimeout(function () { progress.hidden = true; }, 1800);
    }
  }
  async function importarZonificacion() {
    if (state.role !== "ADMINISTRADOR") { showZoneStatus("Solo el administrador puede cargar la zonificación.", true); return; }
    var input = byId("slaZonaArchivoInput");
    var file = input && input.files && input.files[0];
    if (!file) { showZoneStatus("Selecciona el Excel de zonificación.", true); return; }
    var button = byId("slaZonaImportarArchivo");
    var progress = byId("slaZonaCargaProgreso");
    var uploadId = "";
    if (button) button.disabled = true;
    if (progress) { progress.hidden = false; progress.value = 0; }
    showZoneStatus("Leyendo " + file.name + "…", false);
    try {
      var parsed = await parseZonificationFile(file);
      showZoneStatus("Preparando " + parsed.rows.length.toLocaleString("es-PE") + " distritos…", false);
      var start = await api().zonificacion("iniciar_carga", { archivo: file.name, filas: parsed.rows.length });
      uploadId = safeText(start && start.id);
      if (!uploadId) throw new Error("Supabase no devolvió el identificador de la carga de zonificación.");
      var chunkSize = 250;
      for (var i = 0; i < parsed.rows.length; i += chunkSize) {
        var block = parsed.rows.slice(i, i + chunkSize);
        await api().zonificacion("guardar_bloque", { carga_id: uploadId, filas: block });
        if (progress) progress.value = Math.floor(Math.min(95, ((i + block.length) / parsed.rows.length) * 95));
        showZoneStatus("Subiendo zonificación… " + Math.min(i + block.length, parsed.rows.length).toLocaleString("es-PE") + " de " + parsed.rows.length.toLocaleString("es-PE"), false);
      }
      await api().zonificacion("publicar_carga", { carga_id: uploadId });
      uploadId = "";
      if (progress) progress.value = 100;
      state.loadedAt = 0;
      await alAbrir(true);
      showZoneStatus("Zonificación publicada: " + parsed.rows.length.toLocaleString("es-PE") + " distritos de " + file.name + ". Se aplicaron tipo de zona y SLA de traslado/reparto.", false);
    } catch (error) {
      if (uploadId) { try { await api().zonificacion("cancelar_carga", { carga_id: uploadId }); } catch (_) {} }
      showZoneStatus("No se publicó la zonificación; la carga activa se conserva. Detalle: " + (error && error.message || error), true);
    } finally {
      if (button) button.disabled = false;
      if (progress) window.setTimeout(function () { progress.hidden = true; }, 1800);
    }
  }
  async function guardarParametros() {
    if (state.role !== "ADMINISTRADOR") return;
    var ranges = readRangeEditor();
    var validation = validateRanges(ranges);
    if (validation) { showStatus(validation, true); return; }
    ranges.forEach(function (range, index) { range.orden = index + 1; });
    var button = byId("slaGuardarParametros");
    if (button) button.disabled = true;
    try {
      state.config = await api().ejecutar("guardar_parametros", { rangos: ranges });
      state.config.dataset = state.dataset;
      state.ranges = normalizedRanges(state.config);
      state.selectedClass = "";
      if (byId("slaFiltroClasificacion")) byId("slaFiltroClasificacion").value = "";
      renderRangeEditor(state.ranges);
      showStatus("Rangos y tarifas compartidos guardados.", false);
      renderAll();
    } catch (error) {
      showStatus("No se pudieron guardar los parámetros. Detalle: " + (error && error.message || error), true);
    } finally { if (button) button.disabled = false; }
  }
  function selectFromSummary(department, province, district, classification) {
    state.selectedDepartment = department || "";
    state.selectedProvince = province || "";
    state.selectedDistrict = district || "";
    state.selectedClass = classification || "";
    state.page = 1;
    state.showAllDetail = false;
  }
  function init() {
    loadDetailColumnPreferences();
    var tbody = byId("slaResumenBody");
    if (tbody) tbody.addEventListener("click", handleSummaryClick);
    var pricesBody = byId("slaPreciosEditor");
    if (pricesBody) pricesBody.addEventListener("input", updatePriceDraft);
    if (!state.timer) state.timer = window.setInterval(function () { if (state.dataset && !state.loading) renderAll(); }, 60000);
  }
  document.addEventListener("DOMContentLoaded", init);
  window.SlaPaquetesV2 = {
    establecerRol: setRole,
    alAbrir: alAbrir,
    aplicarFiltros: applyFilters,
    limpiarFiltros: clearFilters,
    limpiarSeleccionDetalle: clearSelection,
    expandirTodo: expandAll,
    contraerTodo: collapseAll,
    alternarClasificacion: toggleClasses,
    cambiarColumnaDetalle: changeDetailColumn,
    mostrarTodasColumnas: showAllDetailColumns,
    cambiarPagina: changePage,
    importarArchivo: importarArchivo,
    importarZonificacion: importarZonificacion,
    guardarParametros: guardarParametros,
    guardarPrecios: guardarPrecios,
    filtrarPrecios: filtrarPrecios,
    agregarRango: agregarRango,
    quitarRango: quitarRango
  };
})();
