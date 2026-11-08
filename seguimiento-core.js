/* Seguimiento General de Guias - motor puro, sin red ni dependencias externas.
   Fechas origen interpretadas como hora local de Peru (UTC-05:00). */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.SeguimientoCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY_MS = 86400000;
  const PERU_OFFSET_MS = 5 * 3600000;
  const NO_DATA = 'SIN DATO';
  const clean = value => String(value == null ? '' : value).replace(/\u00a0/g, ' ').trim();
  const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase();
  const key = value => norm(value).replace(/[^A-Z0-9]/g, '');
  const guide = value => norm(value).replace(/\s+/g, '');
  const pdvKey = value => norm(value).split('|')[0].replace(/\.PDV\b/g, '').replace(/\s+/g, '');
  const pdvBase = value => pdvKey(value).replace(/(\d+)[NSEW]$/, '$1');
  function rowGet(row, aliases) {
    const map = row.__headers || Object.fromEntries(Object.keys(row).map(x => [key(x), row[x]]));
    for (const alias of aliases) {
      const candidate = map[key(alias)];
      if (candidate != null && clean(candidate) !== '') return candidate;
    }
    return '';
  }
  function excelDate(value) {
    if (value == null || value === '' || value === '-') return null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 1000 || value > 200000) return null;
      return Math.round((value - 25569) * DAY_MS) + PERU_OFFSET_MS;
    }
    const text = clean(value);
    if (!text) return null;
    // Z and +/-timezone are absolute instants; all other strings are Lima wall time.
    if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(text) && /[T ]\d{2}:\d{2}/.test(text)) {
      const parsed = Date.parse(text);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const match = text.match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)(?:[ T]([0-2]?\d):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?)?$/)
      || text.match(/^([0-3]?\d)[-\/]([01]?\d)[-\/](\d{4})(?:[ T]([0-2]?\d):([0-5]\d)(?::([0-5]\d))?)?$/);
    if (!match) return null;
    const yearFirst = /^\d{4}/.test(text);
    const y = +(yearFirst ? match[1] : match[3]);
    const m = +(yearFirst ? match[2] : match[2]);
    const d = +(yearFirst ? match[3] : match[1]);
    const h = +(match[4] || 0), minute = +(match[5] || 0), sec = +(match[6] || 0);
    const ms = Date.UTC(y, m - 1, d, h, minute, sec);
    const back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d || h > 23) return null;
    return ms + PERU_OFFSET_MS;
  }
  function formatPeru(timestamp, seconds = false) {
    if (timestamp == null || !Number.isFinite(timestamp)) return '—';
    const dt = new Date(timestamp - PERU_OFFSET_MS);
    if (!Number.isFinite(dt.getTime())) return '—';
    const z = n => String(n).padStart(2, '0');
    return `${z(dt.getUTCDate())}-${z(dt.getUTCMonth() + 1)}-${dt.getUTCFullYear()} ${z(dt.getUTCHours())}:${z(dt.getUTCMinutes())}${seconds ? ':' + z(dt.getUTCSeconds()) : ''}`;
  }
  function elapsedDays(time, now = Date.now()) { return time == null || !Number.isFinite(time) ? null : (now - time) / DAY_MS; }
  function elapsedText(time, now = Date.now()) { const n = elapsedDays(time, now); return n == null ? '—' : n.toFixed(8); }
  function parseBoundary(value, isEnd = false) {
    const text = clean(value);
    if (!text) return { value: null, error: '' };
    const m = text.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return { value: null, error: 'Usa dd-mm-aaaa o dd-mm-aaaa HH:mm.' };
    const d = +m[1], mo = +m[2], yr = +m[3];
    const hour = m[4] == null ? (isEnd ? 23 : 0) : +m[4];
    const minute = m[5] == null ? (isEnd ? 59 : 0) : +m[5];
    const sec = m[6] == null ? (isEnd ? 59 : 0) : +m[6];
    const ms = Date.UTC(yr, mo - 1, d, hour, minute, sec, isEnd && !m[4] ? 999 : 0);
    const test = new Date(ms);
    if (test.getUTCDate() !== d || test.getUTCMonth() !== mo - 1 || test.getUTCFullYear() !== yr || hour > 23 || minute > 59 || sec > 59) return { value: null, error: 'Fecha u hora inválida.' };
    return { value: ms + PERU_OFFSET_MS, error: '' };
  }
  function normalizeRows(matrix) {
    if (!Array.isArray(matrix) || !matrix.length) return [];
    const columns = matrix[0].map(x => key(x));
    return matrix.slice(1).filter(row => Array.isArray(row) && row.some(cell => clean(cell) !== '')).map(row => {
      const map = Object.create(null);
      columns.forEach((c, i) => { if (c && !(c in map)) map[c] = row[i] ?? ''; });
      return { __headers: map };
    });
  }
  function normalizePdv(rows) {
    return rows.map(r => ({
      pdv: clean(rowGet(r, ['NOMBRE SIMPLE', 'PDV', 'PUNTO DE DISTRIBUCION', 'NOMBRE.PDV'])),
      alias: clean(rowGet(r, ['NOMBRE.SIMPLE2', 'NOMBRE SIMPLE2', 'ALIAS'])),
      area: clean(rowGet(r, ['Área 区域1', 'AREA', 'ÁREA', 'AREA1', 'ÁREA1'])),
      region: clean(rowGet(r, ['Región', 'REGION'])),
      encargado: clean(rowGet(r, ['ENCARGADO', 'SUPERVISOR']))
    })).filter(p => p.pdv);
  }
  function normalizeExport(rows, file = '') {
    return rows.map(r => {
      const guia = guide(rowGet(r, ['Número de Guía', 'NUMERO DE GUIA', 'NÚMERO DE GUÍA 运单号']));
      if (!guia) return null;
      return {
        guia,
        punto: clean(rowGet(r, ['Punto de escaneo más reciente', 'Ultimo punto de escaneo', 'Último punto de escaneo'])),
        pdv: clean(rowGet(r, ['Punto de entrega', 'PDV de destino'])),
        tipo: clean(rowGet(r, ['Tipo de escaneo más reciente'])),
        tiempoEntrada: excelDate(rowGet(r, ['Tiempo de entrada'])),
        escaneoEn: excelDate(rowGet(r, ['Tiempo del escaneo más reciente', 'Tiempo de escaneo más reciente'])),
        actualizadoEn: excelDate(rowGet(r, ['Última actualización'])),
        provincia: clean(rowGet(r, ['Provincia de destino'])),
        ciudad: clean(rowGet(r, ['Ciudad de Destino', 'Ciudad de destino'])),
        colonia: clean(rowGet(r, ['Colonia de destino'])),
        firma: clean(rowGet(r, ['Estatus de firma'])),
        repartidor: clean(rowGet(r, ['Empleado de entrega'])),
        archivoExportacion: file
      };
    }).filter(Boolean);
  }
  function normalizeMonitor(rows, file = '') {
    return rows.map(r => {
      const guia = guide(rowGet(r, ['Número de Guía', 'NUMERO DE GUIA']));
      if (!guia) return null;
      return {
        guia,
        salidaHub: excelDate(rowGet(r, ['Hora de salida del HUB'])),
        llegadaPdv: excelDate(rowGet(r, ['Hora de llegada al PDV'])),
        tiempoDespacho: excelDate(rowGet(r, ['Tiempo de despacho'])),
        generadoEn: excelDate(rowGet(r, ['Fecha de generación de datos'])),
        archivoMonitoreo: file
      };
    }).filter(Boolean);
  }
  function pickLatest(entries, scoreFields) {
    const map = new Map();
    for (const [idx, row] of entries.entries()) {
      const score = Math.max(...scoreFields.map(f => row[f] ?? -1));
      const old = map.get(row.guia);
      if (!old || score > old.score || (score === old.score && idx > old.idx)) map.set(row.guia, { row, score, idx });
    }
    return new Map([...map].map(([g, info]) => [g, info.row]));
  }
  function catalogMap(catalog) {
    const exact = new Map(), alternative = new Map();
    function push(map, name, record) {
      const k = pdvKey(name); if (!k) return;
      if (!map.has(k)) map.set(k, new Set());
      map.get(k).add(record);
    }
    for (const p of catalog) {
      const rec = { pdv: clean(p.pdv), area: clean(p.area), region: clean(p.region), encargado: clean(p.encargado) };
      push(exact, p.pdv, rec);
      for (const alias of [p.alias, ...(Array.isArray(p.aliases) ? p.aliases : [])]) push(alternative, alias, rec);
      const normalizedBase = pdvBase(p.pdv);
      if (normalizedBase && normalizedBase !== pdvKey(p.pdv)) push(alternative, normalizedBase, rec);
    }
    function resolve(value) {
      const k = pdvKey(value);
      if (!k) return null;
      for (const [map, candidate] of [[exact,k],[alternative,k],[exact,pdvBase(value)],[alternative,pdvBase(value)]]) {
        const found = map.get(candidate);
        if (found?.size === 1) return [...found][0];
        if (found?.size > 1) return null;
      }
      return null;
    }
    return resolve;
  }
  function combine(exports, monitors, catalog) {
    const exp = pickLatest(exports, ['actualizadoEn', 'escaneoEn']);
    const mon = pickLatest(monitors, ['llegadaPdv', 'tiempoDespacho', 'salidaHub', 'generadoEn']);
    const pdv = catalogMap(catalog);
    const rows = [];
    for (const e of exp.values()) {
      const m = mon.get(e.guia) || null;
      const areaScan = pdv(e.punto);
      const areaEntrega = pdv(e.pdv);
      let estadoSla = 'SIN MONITOREO', inicioSla = null, slaOrigen = '';
      if (m) {
        if (m.llegadaPdv != null) {
          estadoSla = 'DESDE LLEGADA PDV'; inicioSla = m.llegadaPdv; slaOrigen = 'Hora de llegada al PDV';
        } else if (m.tiempoDespacho != null && m.salidaHub != null) {
          estadoSla = 'DESDE SALIDA HUB'; inicioSla = m.salidaHub; slaOrigen = 'Hora de salida del HUB';
        } else if (m.tiempoDespacho != null) {
          estadoSla = 'SIN SALIDA HUB';
        } else {
          estadoSla = 'EN TRÁNSITO';
        }
      }
      rows.push({ ...e, salidaHub: m?.salidaHub ?? null, llegadaPdv: m?.llegadaPdv ?? null,
        tiempoDespacho: m?.tiempoDespacho ?? null, archivoMonitoreo: m?.archivoMonitoreo ?? '',
        area: areaScan?.area || 'SIN ÁREA', region: areaScan?.region || 'SIN REGIÓN',
        encargado: areaScan?.encargado || '', areaDestino: areaEntrega?.area || '',
        estadoSla, inicioSla, slaOrigen, tieneMonitoreo: !!m });
    }
    return { rows, totalExport: exports.length, uniqueExport: exp.size, totalMonitor: monitors.length,
      uniqueMonitor: mon.size, matchedMonitor: rows.filter(r => r.tieneMonitoreo).length,
      missingArea: rows.filter(r => r.area === 'SIN ÁREA').length };
  }
  const dateFields = [
    { id: 'tiempoEntrada', name: 'Tiempo de entrada', daysName: 'Días cola larga' },
    { id: 'salidaHub', name: 'Hora de salida del HUB', daysName: 'Días desde HUB' },
    { id: 'llegadaPdv', name: 'Hora de llegada al PDV', daysName: 'Días desde PDV' },
    { id: 'tiempoDespacho', name: 'Tiempo de despacho', daysName: 'Días desde despacho' }
  ];
  function filterRows(rows, filters = {}, now = Date.now()) {
    const dates = filters.dates || {};
    return rows.filter(r => {
      const search = norm(filters.search);
      if (search && ![r.guia,r.punto,r.pdv,r.area,r.region,r.encargado,r.provincia,r.ciudad,r.colonia,r.tipo,r.firma,r.repartidor].some(t => norm(t).includes(search))) return false;
      for (const field of ['area','punto','pdv','tipo','estadoSla','provincia','ciudad','colonia']) {
        const selection = filters[field];
        if (selection && selection.length && !selection.includes(clean(r[field]) || NO_DATA)) return false;
      }
      for (const {id} of dateFields) {
        const f = dates[id]; if (!f) continue;
        const time = r[id]; const days = elapsedDays(time, now);
        if (f.onlyEmpty && time != null) return false;
        if ((f.from != null || f.to != null || f.daysMin != null || f.daysMax != null) && time == null) return false;
        if (f.from != null && time < f.from) return false;
        if (f.to != null && time > f.to) return false;
        if (f.daysMin != null && days < f.daysMin) return false;
        if (f.daysMax != null && days > f.daysMax) return false;
      }
      const sla = elapsedDays(r.inicioSla, now);
      if ((filters.slaMin != null || filters.slaMax != null) && sla == null) return false;
      if (filters.slaMin != null && sla < filters.slaMin) return false;
      if (filters.slaMax != null && sla > filters.slaMax) return false;
      return true;
    });
  }
  function summarize(rows, now = Date.now()) {
    const groups = new Map();
    for (const r of rows) {
      const k = `${r.area}\u001f${r.punto || NO_DATA}`;
      if (!groups.has(k)) groups.set(k, { area: r.area, punto: r.punto || NO_DATA, total: 0, sinSla: 0, sumSla: 0, countSla: 0, sumCola: 0, countCola: 0 });
      const g = groups.get(k); g.total++;
      const sla = elapsedDays(r.inicioSla, now);
      if (sla == null) g.sinSla++; else { g.sumSla += sla; g.countSla++; }
      const cola = elapsedDays(r.tiempoEntrada, now);
      if (cola != null) { g.sumCola += cola; g.countCola++; }
    }
    return [...groups.values()].map(g => ({...g,
      promedioSla: g.countSla ? g.sumSla / g.countSla : null,
      promedioCola: g.countCola ? g.sumCola / g.countCola : null
    })).sort((a,b) => a.area.localeCompare(b.area, 'es') || b.total - a.total || a.punto.localeCompare(b.punto,'es'));
  }
  return { DAY_MS, NO_DATA, clean, norm, key, guide, pdvKey, pdvBase, rowGet, excelDate,
    formatPeru, elapsedDays, elapsedText, parseBoundary, normalizeRows,
    normalizePdv, normalizeExport, normalizeMonitor, pickLatest, catalogMap,
    combine, dateFields, filterRows, summarize };
});
