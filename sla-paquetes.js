(function () {
  "use strict";

  var PAGE_SIZE = 100;
  var state = {
    role: "",
    rows: [],
    config: null,
    dataset: null,
    loadedAt: 0,
    loading: false,
    expanded: new Set(),
    selectedProvince: "",
    selectedDistrict: "",
    selectedClass: "",
    page: 1,
    collapsedClasses: false,
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
  function showStatus(message, isError) {
    var el = byId("slaEstado");
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
    out._provinceKey = keyText(out.departamento) + "|" + keyText(out.provincia);
    out._districtKey = out._provinceKey + "|" + keyText(out.distrito || "SIN DISTRITO");
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
    var threshold = Number(state.config && state.config.umbral_horas || 48);
    var classification = "SIN_INICIO";
    if (start && hours < 0) classification = "INCONSISTENTE";
    else if (start && hours >= threshold) classification = "TARIFA";
    else if (start) classification = "EN_SLA";
    return { start: start, startLabel: label, end: end, signed: signed, hours: hours, classification: classification };
  }
  function classificationLabel(code) {
    var threshold = Number(state.config && state.config.umbral_horas || 48);
    var tariff = Number(state.config && state.config.tarifa_porcentaje || 90);
    if (code === "TARIFA") return "≥ " + threshold + " h · Tarifa " + tariff + "%";
    if (code === "EN_SLA") return "Dentro de " + threshold + " h";
    if (code === "SIN_INICIO") return "Sin fecha de inicio";
    if (code === "INCONSISTENTE") return "Fecha inconsistente";
    if (code === "SIN_FIRMA") return "Sin firma · en curso";
    return "Todas";
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
    var result = { EN_SLA: 0, TARIFA: 0, SIN_INICIO: 0, INCONSISTENTE: 0, SIN_FIRMA: 0 };
    rows.forEach(function (row) {
      result[row._calc.classification] = (result[row._calc.classification] || 0) + 1;
      if (!row._calc.signed) result.SIN_FIRMA++;
    });
    return result;
  }
  function renderCards(rows) {
    var cards = byId("slaResumenCards");
    if (cards) cards.classList.toggle("hidden", !state.dataset);
    if (!state.dataset) return;
    var counts = classCounts(rows);
    if (byId("slaTotalPaquetes")) byId("slaTotalPaquetes").textContent = rows.length.toLocaleString("es-PE");
    if (byId("slaEnPlazo")) byId("slaEnPlazo").textContent = counts.EN_SLA.toLocaleString("es-PE");
    if (byId("slaTarifaAplicada")) byId("slaTarifaAplicada").textContent = counts.TARIFA.toLocaleString("es-PE");
    if (byId("slaSinFirma")) byId("slaSinFirma").textContent = counts.SIN_FIRMA.toLocaleString("es-PE");
  }
  function groupRows(rows) {
    var provinces = new Map();
    rows.forEach(function (row) {
      var provinceKey = row._provinceKey || "SIN DEPARTAMENTO|SIN PROVINCIA";
      var province = provinces.get(provinceKey);
      if (!province) {
        province = { key: provinceKey, departamento: row.departamento || "Sin departamento", provincia: row.provincia || "Sin provincia", rows: [], districts: new Map() };
        provinces.set(provinceKey, province);
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
    return Array.from(provinces.values()).sort(function (a, b) {
      return (a.provincia + a.departamento).localeCompare(b.provincia + b.departamento, "es");
    }).map(function (province) {
      province.districtList = Array.from(province.districts.values()).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); });
      return province;
    });
  }
  function actionButton(label, action, provinceKey, districtKey, classification, className) {
    return '<button type="button" class="sla-count-link ' + (className || "") + '" data-sla-action="select" data-province="' + encodeURIComponent(provinceKey || "") + '" data-district="' + encodeURIComponent(districtKey || "") + '" data-class="' + encodeURIComponent(classification || "") + '" aria-label="Ver ' + escapeHtml(label) + ' paquetes">' + Number(label || 0).toLocaleString("es-PE") + '</button>';
  }
  function countCells(rows, provinceKey, districtKey) {
    var c = classCounts(rows);
    var hidden = state.collapsedClasses ? " hidden" : "";
    return '<td class="number">' + actionButton(rows.length, "select", provinceKey, districtKey, "", "") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + actionButton(c.EN_SLA, "select", provinceKey, districtKey, "EN_SLA", "sla-good") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + actionButton(c.TARIFA, "select", provinceKey, districtKey, "TARIFA", "sla-bad") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + actionButton(c.SIN_INICIO, "select", provinceKey, districtKey, "SIN_INICIO", "sla-open") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + actionButton(c.INCONSISTENTE, "select", provinceKey, districtKey, "INCONSISTENTE", "sla-open") + '</td>' +
      '<td class="number">' + actionButton(c.SIN_FIRMA, "select", provinceKey, districtKey, "SIN_FIRMA", "sla-open") + '</td>';
  }
  function renderSummary(rows) {
    var tbody = byId("slaResumenBody");
    if (!tbody) return;
    var groups = groupRows(rows);
    if (!groups.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="sla-empty">No hay paquetes que coincidan con los filtros.</td></tr>';
      return;
    }
    var html = "";
    groups.forEach(function (province) {
      var expanded = state.expanded.has(province.key);
      var selected = state.selectedProvince === province.key && !state.selectedDistrict ? " sla-row-selected" : "";
      html += '<tr class="sla-province-row' + selected + '"><td><button type="button" class="sla-group-toggle" data-sla-action="toggle-province" data-province="' + encodeURIComponent(province.key) + '" aria-expanded="' + String(expanded) + '"><span class="sla-arrow">' + (expanded ? "▾" : "▸") + '</span><span>' + escapeHtml(province.provincia) + ' · ' + escapeHtml(province.departamento) + '</span></button></td>' + countCells(province.rows, province.key, "") + '</tr>';
      if (expanded) province.districtList.forEach(function (district) {
        var districtSelected = state.selectedDistrict === district.key ? " sla-row-selected" : "";
        html += '<tr class="sla-district-row' + districtSelected + '"><td><button type="button" class="sla-detail-link" data-sla-action="select" data-province="' + encodeURIComponent(province.key) + '" data-district="' + encodeURIComponent(district.key) + '" data-class="">↳ ' + escapeHtml(district.nombre) + '</button></td>' + countCells(district.rows, province.key, district.key) + '</tr>';
      });
    });
    var totals = classCounts(rows);
    var hidden = state.collapsedClasses ? " hidden" : "";
    html += '<tr class="sla-total-row"><td>TOTAL GENERAL</td><td class="number">' + rows.length.toLocaleString("es-PE") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + totals.EN_SLA.toLocaleString("es-PE") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + totals.TARIFA.toLocaleString("es-PE") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + totals.SIN_INICIO.toLocaleString("es-PE") + '</td>' +
      '<td class="number sla-classification-col' + hidden + '">' + totals.INCONSISTENTE.toLocaleString("es-PE") + '</td>' +
      '<td class="number">' + totals.SIN_FIRMA.toLocaleString("es-PE") + '</td></tr>';
    tbody.innerHTML = html;
    var status = byId("slaFiltroEstado");
    if (status) status.textContent = rows.length.toLocaleString("es-PE") + " paquetes · " + groups.length.toLocaleString("es-PE") + " provincias";
  }
  function selectedRows(rows) {
    return rows.filter(function (row) {
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
    rows = selectedRows(rows);
    var hasSelection = !!(state.selectedProvince || state.selectedDistrict || state.selectedClass || filters.search || filters.classification);
    panel.classList.toggle("hidden", !hasSelection && !state.showAllDetail);
    if (!hasSelection && !state.showAllDetail) return;
    var title = byId("slaDetalleTitulo");
    if (title) {
      var parts = ["Detalle de paquetes"];
      if (state.selectedProvince) {
        var g = groupRows(state.rows).find(function (x) { return x.key === state.selectedProvince; });
        if (g) parts.push(g.provincia + " · " + g.departamento);
      }
      if (state.selectedDistrict) parts.push(state.selectedDistrict.split("|").slice(-1)[0] || "Distrito");
      if (state.selectedClass) parts.push(classificationLabel(state.selectedClass));
      title.textContent = parts.join(" · ");
    }
    var note = byId("slaDetalleFiltro");
    if (note) note.textContent = rows.length.toLocaleString("es-PE") + " guías/PDV. El tiempo se recalcula hasta ahora en los paquetes sin firma.";
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), pages);
    var from = (state.page - 1) * PAGE_SIZE;
    var pageRows = rows.slice(from, from + PAGE_SIZE);
    if (!pageRows.length) {
      tbody.innerHTML = '<tr><td colspan="19" class="sla-empty">No hay registros para mostrar.</td></tr>';
    } else {
      tbody.innerHTML = pageRows.map(function (row) {
        var c = row._calc;
        var badge = c.classification === "TARIFA" ? "tarifa" : c.classification === "SIN_INICIO" ? "sin-inicio" : c.classification === "INCONSISTENTE" ? "inconsistente" : "";
        var hours = c.hours === null ? "—" : c.hours.toFixed(2) + " h";
        var endLabel = c.signed ? "Firma" : "Ahora";
        var values = [row.guia,row.pdv,row.departamento,row.provincia,row.distrito,(c.startLabel ? c.startLabel + " · " : "") + formatDate(c.start),endLabel + " · " + formatDate(c.end),formatDate(row.fecha_generacion),formatDate(row.salida_hub),formatDate(row.llegada_cedis),formatDate(row.salida_cedis),formatDate(row.llegada_pdv),formatDate(row.despacho),formatDate(row.firma),formatDate(row.problema),formatDate(row.retorno_almacen),formatDate(row.devolucion),hours];
        return '<tr>' + values.map(function (value, index) { return '<td' + (index === 5 || index === 6 ? ' class="sla-destino-hito"' : "") + '>' + escapeHtml(value || "—") + '</td>'; }).join("") + '<td><span class="sla-class-badge ' + badge + '">' + escapeHtml(classificationLabel(c.classification)) + '</span></td></tr>';
      }).join("");
    }
    var prev = byId("slaDetallePrev");
    var next = byId("slaDetalleNext");
    var info = byId("slaDetallePaginaInfo");
    if (prev) prev.disabled = state.page <= 1;
    if (next) next.disabled = state.page >= pages;
    if (info) info.textContent = rows.length ? (from + 1).toLocaleString("es-PE") + "–" + Math.min(from + PAGE_SIZE, rows.length).toLocaleString("es-PE") + " de " + rows.length.toLocaleString("es-PE") : "0 resultados";
  }
  function renderAll() {
    var rows = filteredRows();
    renderCards(rows);
    renderSummary(rows);
    renderDetail();
    var threshold = Number(state.config && state.config.umbral_horas || 48);
    var tariff = Number(state.config && state.config.tarifa_porcentaje || 90);
    if (byId("slaCumpleHeader")) byId("slaCumpleHeader").textContent = "Dentro de " + threshold + " h";
    if (byId("slaTarifaHeader")) byId("slaTarifaHeader").textContent = "≥ " + threshold + " h · Tarifa " + tariff + "%";
    var toggle = byId("slaToggleClasificacion");
    if (toggle) toggle.textContent = state.collapsedClasses ? "Mostrar columnas de clasificación" : "Ocultar columnas de clasificación";
    document.querySelectorAll("#viewSla .sla-classification-col").forEach(function (cell) { cell.hidden = state.collapsedClasses; });
  }
  function applyDataset(data, config) {
    state.rows = (data || []).map(normalizeRow);
    state.config = config || state.config || { umbral_horas: 48, tarifa_porcentaje: 90 };
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
  async function alAbrir(force) {
    if (state.loading) return;
    if (!force && state.loadedAt && Date.now() - state.loadedAt < 20000) { renderAll(); return; }
    state.loading = true;
    showStatus("Consultando parámetros y archivo SLA…", false);
    try {
      var config = await api().ejecutar("config", {});
      state.config = config || { umbral_horas: 48, tarifa_porcentaje: 90 };
      if (byId("slaUmbralHoras")) byId("slaUmbralHoras").value = state.config.umbral_horas || 48;
      if (byId("slaTarifaPorcentaje")) byId("slaTarifaPorcentaje").value = state.config.tarifa_porcentaje || 90;
      var result = await loadAllPages();
      applyDataset(result.rows, config);
      state.dataset = result.dataset || config.dataset || null;
      state.loadedAt = Date.now();
      state.page = 1;
      if (!state.dataset) {
        state.rows = [];
        showStatus("Aún no hay un archivo de SLA publicado. Un administrador puede cargar el Excel de monitoreo.", false);
      } else {
        var globalCount = Number(state.dataset.filas || 0);
        var visibleCount = state.rows.length;
        showStatus("Archivo activo: " + safeText(state.dataset.archivo || "Monitoreo") + " · " + visibleCount.toLocaleString("es-PE") + " paquetes disponibles" + (globalCount > visibleCount ? " de " + globalCount.toLocaleString("es-PE") + " en la carga" : "") + ".", false);
      }
      renderAll();
    } catch (error) {
      showStatus("No se pudo cargar el módulo SLA. Verifica que ejecutaste supabase_gestion_v2_sla_paquetes.sql. Detalle: " + (error && error.message || error), true);
    } finally { state.loading = false; }
  }
  function setRole(role) {
    state.role = safeText(role).toUpperCase();
    var admin = byId("slaAdminTools");
    if (admin) admin.classList.toggle("hidden", state.role !== "ADMINISTRADOR");
  }
  function applyFilters() {
    state.page = 1;
    renderAll();
  }
  function clearFilters() {
    if (byId("slaBuscar")) byId("slaBuscar").value = "";
    if (byId("slaFiltroClasificacion")) byId("slaFiltroClasificacion").value = "";
    state.selectedProvince = "";
    state.selectedDistrict = "";
    state.selectedClass = "";
    state.showAllDetail = false;
    state.page = 1;
    renderAll();
  }
  function clearSelection() {
    state.selectedProvince = "";
    state.selectedDistrict = "";
    state.selectedClass = "";
    state.showAllDetail = true;
    state.page = 1;
    renderAll();
  }
  function expandAll() {
    filteredRows().forEach(function (row) { state.expanded.add(row._provinceKey); });
    renderAll();
  }
  function collapseAll() { state.expanded.clear(); renderAll(); }
  function toggleClasses() { state.collapsedClasses = !state.collapsedClasses; renderAll(); }
  function changePage(delta) { state.page += Number(delta || 0); renderDetail(); }
  function handleSummaryClick(event) {
    var button = event.target.closest("[data-sla-action]");
    if (!button) return;
    var action = button.getAttribute("data-sla-action");
    var province = decodeURIComponent(button.getAttribute("data-province") || "");
    if (action === "toggle-province") {
      if (state.expanded.has(province)) state.expanded.delete(province); else state.expanded.add(province);
      renderSummary(filteredRows());
      return;
    }
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
        departamento: findHeaderIndex(headers, ["Provincia de destino", "Departamento de destino"]),
        provincia: findHeaderIndex(headers, ["Ciudad de destino", "Provincia de destino (ciudad)"]),
        distrito: findHeaderIndex(headers, ["Colonia de destino", "Distrito de destino"]),
        region: findHeaderIndex(headers, ["Región de destino", "Region de destino"]),
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
      var fallback = { guia: 0, pdv: 3, departamento: 6, provincia: 7, distrito: 9, region: 5, fecha_generacion: 10, salida_hub: 12, llegada_cedis: 14, salida_cedis: 15, llegada_pdv: 16, despacho: 17, firma: 22, problema: 24, retorno_almacen: 26, devolucion: 28 };
      Object.keys(fallback).forEach(function (key) { if (columns[key] < 0) columns[key] = fallback[key]; });
      var records = [];
      var unique = new Map();
      for (var i = headerRow + 1; i < matrix.length; i++) {
        var row = matrix[i];
        var guide = safeText(row[columns.guia]).trim();
        var pdv = safeText(row[columns.pdv]).trim();
        if (!guide || !pdv) continue;
        var record = { guia: guide, pdv: pdv };
        ["departamento","provincia","distrito","region","fecha_generacion","salida_hub","llegada_cedis","salida_cedis","llegada_pdv","despacho","firma","problema","retorno_almacen","devolucion"].forEach(function (key) {
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
    if (state.role !== "ADMINISTRADOR") { showStatus("Solo el administrador puede cargar el archivo SLA.", true); return; }
    var input = byId("slaArchivoInput");
    var file = input && input.files && input.files[0];
    if (!file) { showStatus("Selecciona el archivo Excel de monitoreo.", true); return; }
    var button = byId("slaImportarArchivo");
    var progress = byId("slaCargaProgreso");
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
          region: match ? match.region : row.region
        });
      });
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
      state.selectedProvince = "";
      state.selectedDistrict = "";
      state.selectedClass = "";
      state.showAllDetail = false;
      await alAbrir(true);
      showStatus("Carga publicada: " + parsed.rows.length.toLocaleString("es-PE") + " guías de " + file.name + ".", false);
    } catch (error) {
      if (uploadId) { try { await api().ejecutar("cancelar_carga", { carga_id: uploadId }); } catch (_) {} }
      showStatus("No se publicó el archivo; la carga activa se conserva. Detalle: " + (error && error.message || error), true);
    } finally {
      if (button) button.disabled = false;
      if (progress) window.setTimeout(function () { progress.hidden = true; }, 1800);
    }
  }
  async function guardarParametros() {
    if (state.role !== "ADMINISTRADOR") return;
    var umbral = Number(byId("slaUmbralHoras") && byId("slaUmbralHoras").value);
    var tarifa = Number(byId("slaTarifaPorcentaje") && byId("slaTarifaPorcentaje").value);
    if (!isFinite(umbral) || umbral < 1 || umbral > 8760 || !isFinite(tarifa) || tarifa < 0 || tarifa > 100) {
      showStatus("Ingresa un umbral entre 1 y 8760 horas y una tarifa entre 0 y 100%.", true);
      return;
    }
    var button = byId("slaGuardarParametros");
    if (button) button.disabled = true;
    try {
      state.config = await api().ejecutar("guardar_parametros", { umbral_horas: umbral, tarifa_porcentaje: tarifa });
      state.config.dataset = state.dataset;
      showStatus("Parámetros compartidos guardados: " + umbral + " horas → tarifa " + tarifa + "%.", false);
      renderAll();
    } catch (error) {
      showStatus("No se pudieron guardar los parámetros. Detalle: " + (error && error.message || error), true);
    } finally { if (button) button.disabled = false; }
  }
  function selectFromSummary(province, district, classification) {
    state.selectedProvince = province || "";
    state.selectedDistrict = district || "";
    state.selectedClass = classification || "";
    state.page = 1;
    state.showAllDetail = false;
  }
  function init() {
    var tbody = byId("slaResumenBody");
    if (tbody) tbody.addEventListener("click", handleSummaryClick);
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
    cambiarPagina: changePage,
    importarArchivo: importarArchivo,
    guardarParametros: guardarParametros
  };
})();
