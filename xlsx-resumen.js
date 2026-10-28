/* Generador autocontenido de XLSX para el resumen de Gestión V2. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.XlsxResumenV2 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const enc = new TextEncoder();
  const crcTabla = (() => {
    const tabla = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      tabla[n] = c >>> 0;
    }
    return tabla;
  })();

  function escaparXml(valor) {
    return String(valor == null ? "" : valor)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function colorArgb(valor) {
    const s = String(valor || "").trim();
    const hex = s.match(/^#([0-9a-f]{6})$/i);
    if (hex) return "FF" + hex[1].toUpperCase();
    const rgb = s.match(/^rgba?\(([^)]+)\)$/i);
    if (!rgb) return null;
    const partes = rgb[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
    if (partes.length < 3) return null;
    if (partes[3] && parseFloat(partes[3]) === 0) return null;
    const canal = partes.slice(0, 3).map(x => {
      const n = parseFloat(x);
      const v = x.endsWith("%") ? n * 2.55 : n;
      return Math.max(0, Math.min(255, Math.round(Number.isFinite(v) ? v : 0)))
        .toString(16).padStart(2, "0");
    }).join("").toUpperCase();
    return "FF" + canal;
  }

  function bordeCss(ancho, estilo, color) {
    if (!ancho || estilo === "none" || !color) return null;
    if (estilo === "double") return { style: "double", color };
    if (estilo === "dotted") return { style: "dotted", color };
    if (String(estilo).includes("dash")) return { style: "dashed", color };
    return { style: ancho >= 3 ? "thick" : ancho >= 2 ? "medium" : "thin", color };
  }

  function estiloDeCelda(elemento) {
    const cs = getComputedStyle(elemento);
    const peso = String(cs.fontWeight || "400");
    const fuente = String(cs.fontFamily || "Arial").split(",")[0].replace(/[\"']/g, "").trim() || "Arial";
    const fontColor = colorArgb(cs.color) || "FF1F2937";
    const background = colorArgb(cs.backgroundColor);
    const font = {
      name: fuente,
      size: Math.max(8, Math.min(24, (parseFloat(cs.fontSize) || 13) * 0.75)),
      color: fontColor,
      bold: peso === "bold" || Number(peso) >= 600,
      italic: cs.fontStyle === "italic",
      underline: String(cs.textDecorationLine || "").includes("underline")
    };
    const borders = {};
    [["top", "Top"], ["right", "Right"], ["bottom", "Bottom"], ["left", "Left"]].forEach(([side, prop]) => {
      const b = bordeCss(parseFloat(cs["border" + prop + "Width"]) || 0,
        cs["border" + prop + "Style"], colorArgb(cs["border" + prop + "Color"]));
      if (b) borders[side] = b;
    });
    const horizontal = cs.textAlign === "start" ? "left" : cs.textAlign === "end" ? "right" :
      ["left", "right", "center", "justify"].includes(cs.textAlign) ? cs.textAlign : "center";
    return {
      font,
      fill: background,
      border: borders,
      alignment: {
        horizontal,
        vertical: cs.verticalAlign === "top" ? "top" : cs.verticalAlign === "bottom" ? "bottom" : "center",
        wrapText: cs.whiteSpace !== "nowrap" && cs.whiteSpace !== "pre"
      }
    };
  }

  function valorCelda(texto) {
    const t = String(texto == null ? "" : texto).replace(/\u00a0/g, " ").trim();
    if (!t) return { type: "blank", value: "" };
    if (/^-?\d+$/.test(t)) return { type: "number", value: String(Number(t)) };
    if (/^-?\d{1,3}(?:,\d{3})+$/.test(t) || /^-?\d{1,3}(?:\.\d{3})+$/.test(t)) {
      return { type: "number", value: String(Number(t.replace(/[,.]/g, ""))) };
    }
    return { type: "string", value: t };
  }

  function nombreColumna(n) {
    let salida = "";
    while (n > 0) {
      const r = (n - 1) % 26;
      salida = String.fromCharCode(65 + r) + salida;
      n = Math.floor((n - 1) / 26);
    }
    return salida;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTabla[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosFechaHora() {
    const d = new Date();
    const year = Math.max(1980, d.getFullYear());
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function zipSinCompresion(archivos) {
    const locales = [], centrales = [];
    const fecha = dosFechaHora();
    let offset = 0, tamCentral = 0;
    const u16 = (v, n, x) => v.setUint16(n, x, true);
    const u32 = (v, n, x) => v.setUint32(n, x >>> 0, true);
    archivos.forEach(archivo => {
      const nombre = enc.encode(archivo.nombre), datos = enc.encode(archivo.contenido), crc = crc32(datos);
      const local = new Uint8Array(30 + nombre.length), lv = new DataView(local.buffer);
      u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0);
      u16(lv, 10, fecha.time); u16(lv, 12, fecha.date); u32(lv, 14, crc);
      u32(lv, 18, datos.length); u32(lv, 22, datos.length); u16(lv, 26, nombre.length); u16(lv, 28, 0);
      local.set(nombre, 30); locales.push(local, datos);

      const central = new Uint8Array(46 + nombre.length), cv = new DataView(central.buffer);
      u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, 0);
      u16(cv, 12, fecha.time); u16(cv, 14, fecha.date); u32(cv, 16, crc);
      u32(cv, 20, datos.length); u32(cv, 24, datos.length); u16(cv, 28, nombre.length); u16(cv, 30, 0);
      u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0); u32(cv, 38, 0); u32(cv, 42, offset); central.set(nombre, 46);
      centrales.push(central); offset += local.length + datos.length; tamCentral += central.length;
    });
    const fin = new Uint8Array(22), fv = new DataView(fin.buffer);
    u32(fv, 0, 0x06054b50); u16(fv, 4, 0); u16(fv, 6, 0);
    u16(fv, 8, archivos.length); u16(fv, 10, archivos.length);
    u32(fv, 12, tamCentral); u32(fv, 16, offset); u16(fv, 20, 0);
    const total = offset + tamCentral + fin.length, salida = new Uint8Array(total);
    let cursor = 0;
    [...locales, ...centrales, fin].forEach(parte => { salida.set(parte, cursor); cursor += parte.length; });
    return salida;
  }

  function generarXlsx(datos) {
    const filas = datos.filas || [], anchos = datos.anchos || [];
    if (!filas.length) throw new Error("La tabla resumen no contiene filas.");
    if (filas.length > 1048576) throw new Error("El resumen supera el límite de filas de Excel.");
    const maxCols = Math.max(14, anchos.length), ocupadasHasta = new Map();
    const matriz = Array.from({ length: filas.length }, () => new Map()), combinadas = [];
    const fuentes = [{ name: "Calibri", size: 11, color: "FF000000", bold: false, italic: false, underline: false }];
    const rellenos = [null, "FFBFBFBF"];
    const bordes = [{}];
    const xfs = [{ fontId: 0, fillId: 0, borderId: 0, alignment: { horizontal: "general", vertical: "center", wrapText: false } }];
    const mapaFuentes = new Map([[JSON.stringify(fuentes[0]), 0]]), mapaRellenos = new Map([["none", 0], ["FFBFBFBF", 1]]);
    const mapaBordes = new Map([["{}", 0]]), mapaXfs = new Map([[JSON.stringify(xfs[0]), 0]]);

    function estiloId(estilo) {
      const f = estilo.font || {}, fuente = {
        name: f.name || "Arial", size: Math.round((Number(f.size) || 10) * 100) / 100,
        color: f.color || "FF1F2937", bold: Boolean(f.bold), italic: Boolean(f.italic), underline: Boolean(f.underline)
      };
      const fk = JSON.stringify(fuente);
      let fontId = mapaFuentes.get(fk);
      if (fontId == null) { fontId = fuentes.length; fuentes.push(fuente); mapaFuentes.set(fk, fontId); }
      const fill = estilo.fill || null, fillKey = fill || "none";
      let fillId = mapaRellenos.get(fillKey);
      if (fillId == null) { fillId = rellenos.length; rellenos.push(fill); mapaRellenos.set(fillKey, fillId); }
      const b = estilo.border || {}, bk = JSON.stringify(b);
      let borderId = mapaBordes.get(bk);
      if (borderId == null) { borderId = bordes.length; bordes.push(b); mapaBordes.set(bk, borderId); }
      const a = estilo.alignment || {}, xf = {
        fontId, fillId, borderId,
        alignment: {
          horizontal: ["left", "right", "center", "justify", "distributed"].includes(a.horizontal) ? a.horizontal : "center",
          vertical: ["top", "center", "bottom", "justify", "distributed"].includes(a.vertical) ? a.vertical : "center",
          wrapText: Boolean(a.wrapText)
        }
      };
      const key = JSON.stringify(xf);
      let id = mapaXfs.get(key);
      if (id == null) { id = xfs.length; xfs.push(xf); mapaXfs.set(key, id); }
      return id;
    }

    filas.forEach((fila, idx) => {
      const r = idx + 1;
      (fila.celdas || []).forEach(celda => {
        const colspan = Math.max(1, Number(celda.colspan) || 1);
        const rowspan = Math.max(1, Number(celda.rowspan) || 1);
        let col = 1;
        while (true) {
          while ((ocupadasHasta.get(col) || 0) >= r) col++;
          let libre = true;
          for (let c = col; c < col + colspan; c++) {
            if (c > maxCols) throw new Error(`La tabla excede ${maxCols} columnas en la fila ${r} al colocar “${celda.texto || ""}” (columna ${col}, abarca ${colspan}).`);
            if ((ocupadasHasta.get(c) || 0) >= r) { col = c + 1; libre = false; break; }
          }
          if (libre) break;
        }
        const finCol = col + colspan - 1, finFila = Math.min(filas.length, r + rowspan - 1);
        const style = estiloId(celda.estilo || {}), valor = valorCelda(celda.texto);
        for (let rr = r; rr <= finFila; rr++) {
          for (let cc = col; cc <= finCol; cc++) {
            matriz[rr - 1].set(cc, { style, value: rr === r && cc === col ? valor : { type: "blank", value: "" } });
            ocupadasHasta.set(cc, finFila);
          }
        }
        if (colspan > 1 || rowspan > 1) combinadas.push(`${nombreColumna(col)}${r}:${nombreColumna(finCol)}${finFila}`);
      });
    });

    const fuentesXml = fuentes.map(f => `<font>${f.bold ? "<b/>" : ""}${f.italic ? "<i/>" : ""}${f.underline ? '<u val="single"/>' : ""}<color rgb="${f.color}"/><sz val="${f.size}"/><name val="${escaparXml(f.name)}"/><family val="2"/></font>`).join("");
    const rellenosXml = `<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
      rellenos.slice(2).map(c => `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`).join("");
    const lados = ["left", "right", "top", "bottom", "diagonal"];
    const bordesXml = bordes.map(b => `<border>${lados.map(l => {
      const x = b[l]; if (!x) return `<${l}/>`;
      return `<${l} style="${x.style}"><color rgb="${x.color}"/></${l}>`;
    }).join("")}</border>`).join("");
    const xfsXml = xfs.map(x => `<xf numFmtId="0" fontId="${x.fontId}" fillId="${x.fillId}" borderId="${x.borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${x.alignment.horizontal}" vertical="${x.alignment.vertical}"${x.alignment.wrapText ? ' wrapText="1"' : ""}/></xf>`).join("");
    const estilosXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fuentes.length}">${fuentesXml}</fonts><fills count="${rellenos.length}">${rellenosXml}</fills><borders count="${bordes.length}">${bordesXml}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfsXml}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

    const filasXml = matriz.map((fila, idx) => {
      const r = idx + 1, celdas = [...fila.entries()].sort((a, b) => a[0] - b[0]).map(([col, celda]) => {
        const ref = `${nombreColumna(col)}${r}`, estilo = ` s="${celda.style}"`;
        if (celda.value.type === "blank") return `<c r="${ref}"${estilo}/>`;
        if (celda.value.type === "number") return `<c r="${ref}"${estilo}><v>${celda.value.value}</v></c>`;
        return `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${escaparXml(celda.value.value)}</t></is></c>`;
      }).join("");
      const alto = Math.max(15, Math.min(409, (Number(filas[idx].altoPx) || 24) * 0.75));
      return `<row r="${r}" ht="${alto.toFixed(2)}" customHeight="1">${celdas}</row>`;
    }).join("");
    const colsXml = anchos.map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${Math.max(8, Math.min(55, Number(w) || 10)).toFixed(2)}" customWidth="1"/>`).join("");
    const mergesXml = combinadas.length ? `<mergeCells count="${combinadas.length}">${combinadas.map(r => `<mergeCell ref="${r}"/>`).join("")}</mergeCells>` : "";
    const ultimaCol = nombreColumna(maxCols), ultimaFila = filas.length;
    const hojaXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${ultimaCol}${ultimaFila}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A4" sqref="A4"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${colsXml}</cols><sheetData>${filasXml}</sheetData>${mergesXml}<printOptions gridLines="0"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
    const workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Resumen V2" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
    return zipSinCompresion([
      { nombre: "[Content_Types].xml", contenido: contentTypes },
      { nombre: "_rels/.rels", contenido: rootRels },
      { nombre: "xl/workbook.xml", contenido: workbookXml },
      { nombre: "xl/_rels/workbook.xml.rels", contenido: wbRels },
      { nombre: "xl/styles.xml", contenido: estilosXml },
      { nombre: "xl/worksheets/sheet1.xml", contenido: hojaXml }
    ]);
  }

  function generarDesdeTabla(tabla) {
    if (typeof getComputedStyle !== "function") throw new Error("Este navegador no permite leer el formato de la tabla.");
    const columnas = Array.from(tabla.querySelectorAll("colgroup col"));
    const anchoTabla = tabla.getBoundingClientRect().width || 1320;
    const anchos = Array.from({ length: Math.max(14, columnas.length) }, (_, i) => {
      const c = columnas[i], px = c ? c.getBoundingClientRect().width || 0 : 0;
      const pct = c ? parseFloat(c.style.width) || 0 : 0;
      return Math.max(8, Math.min(55, (px || anchoTabla * (pct ? pct / 100 : 1 / Math.max(14, columnas.length))) / 7));
    });
    const htmlFilas = Array.from(tabla.rows || []);
    const filaCabecera = htmlFilas.find(f => String(f.parentElement?.tagName || "").toUpperCase() === "THEAD") || htmlFilas[0];
    const columnasTabla = Array.from(filaCabecera?.cells || []).reduce((total, celda) => total + (celda.colSpan || 1), 0);
    const celdaCabeceraComentarios = filaCabecera?.cells?.[filaCabecera.cells.length - 1];
    const estiloComentarios = celdaCabeceraComentarios ? estiloDeCelda(celdaCabeceraComentarios) : {};
    anchos.push(42, 58);
    const filas = htmlFilas.map(fila => {
      const celdas = Array.from(fila.cells || []).map(celda => ({
        texto: String(celda.innerText || celda.textContent || "").replace(/\u00a0/g, " ").trim(),
        colspan: celda.colSpan || 1,
        rowspan: celda.rowSpan || 1,
        estilo: estiloDeCelda(celda)
      }));
      let altoPx = fila.getBoundingClientRect().height || 24;
      if (fila === filaCabecera) {
        celdas.push({ texto: "COMENTARIO", colspan: 1, rowspan: 3, estilo: estiloComentarios });
        celdas.push({ texto: "CLASIFICACIÓN DE PAQUETES CRÍTICOS · SUBTIPOS Y COMENTARIO ENCARGADO", colspan: 1, rowspan: 3, estilo: estiloComentarios });
      } else if (String(fila.parentElement?.tagName || "").toUpperCase() === "THEAD") {
        // Las dos columnas adicionales de resumen ya cubren las tres filas del encabezado.
      } else if (celdas.length === 1 && celdas[0].colspan >= 14) {
        celdas[0].colspan = columnasTabla + 2;
      } else {
        const celdaComentario = Array.from(fila.cells || []).find(c => c.classList?.contains("comment-col"));
        const comentario = String(celdaComentario?.dataset?.excelComment || "").trim();
        const resumenCritico = String(celdaComentario?.dataset?.excelCriticalSummary || "").trim();
        const estilo = celdaComentario ? estiloDeCelda(celdaComentario) : estiloComentarios;
        estilo.alignment = { ...estilo.alignment, horizontal: "left", vertical: "top", wrapText: true };
        celdas.push({ texto: comentario, estilo });
        celdas.push({ texto: resumenCritico, estilo: { ...estilo, alignment: { ...estilo.alignment } } });
        if (comentario) altoPx = Math.max(altoPx, Math.min(545, Math.ceil(comentario.length / 58) * 18 + 8));
        if (resumenCritico) altoPx = Math.max(altoPx, Math.min(545, Math.max(resumenCritico.split(/\n/).length, Math.ceil(resumenCritico.length / 72)) * 16 + 10));
      }
      return { altoPx, celdas };
    });
    return generarXlsx({ filas, anchos });
  }

  function leerZipXlsx(bytes) {
    const archivos = new Map(), vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
    let offset = 0;
    while (offset + 30 <= bytes.length && vista.getUint32(offset, true) === 0x04034b50) {
      const comprimido = vista.getUint32(offset + 18, true), largoNombre = vista.getUint16(offset + 26, true), largoExtra = vista.getUint16(offset + 28, true);
      const inicioNombre = offset + 30, inicioDatos = inicioNombre + largoNombre + largoExtra;
      const nombre = decoder.decode(bytes.subarray(inicioNombre, inicioNombre + largoNombre));
      archivos.set(nombre, decoder.decode(bytes.subarray(inicioDatos, inicioDatos + comprimido)));
      offset = inicioDatos + comprimido;
    }
    if (!archivos.has("xl/worksheets/sheet1.xml") || !archivos.has("xl/styles.xml")) throw new Error("No se pudo preparar una de las pestañas del Excel.");
    return archivos;
  }

  function agregarEstilosResumenSubtipos(stylesXml) {
    let xml = stylesXml;
    const fonts = Number((xml.match(/<fonts count="(\d+)">/) || [])[1]);
    const fills = Number((xml.match(/<fills count="(\d+)">/) || [])[1]);
    const borders = Number((xml.match(/<borders count="(\d+)">/) || [])[1]);
    const xfs = Number((xml.match(/<cellXfs count="(\d+)">/) || [])[1]);
    if (![fonts, fills, borders, xfs].every(Number.isFinite)) throw new Error("No se pudieron preparar los estilos del Excel.");

    const nuevosFont = `<font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/><family val="2"/></font><font><b/><color rgb="FF153E67"/><sz val="10"/><name val="Arial"/><family val="2"/></font>`;
    const nuevosFill = `<fill><patternFill patternType="solid"><fgColor rgb="FF153E67"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>`;
    const nuevoBorder = `<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>`;
    const nuevosXfs = `<xf numFmtId="0" fontId="${fonts}" fillId="${fills}" borderId="${borders}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="${fonts + 1}" fillId="${fills + 1}" borderId="${borders}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>`;

    xml = xml.replace(`<fonts count="${fonts}">`, `<fonts count="${fonts + 2}">`).replace("</fonts>", `${nuevosFont}</fonts>`);
    xml = xml.replace(`<fills count="${fills}">`, `<fills count="${fills + 2}">`).replace("</fills>", `${nuevosFill}</fills>`);
    xml = xml.replace(`<borders count="${borders}">`, `<borders count="${borders + 1}">`).replace("</borders>", `${nuevoBorder}</borders>`);
    xml = xml.replace(`<cellXfs count="${xfs}">`, `<cellXfs count="${xfs + 2}">`).replace("</cellXfs>", `${nuevosXfs}</cellXfs>`);
    return { xml, headerStyle: xfs, subtotalStyle: xfs + 1 };
  }

  function crearHojaResumenSubtiposXml(datos, estilos) {
    const encabezados = datos?.encabezados || [];
    const filas = datos?.filas || [];
    if (!encabezados.length) throw new Error("No se definieron las columnas del resumen por subtipos.");
    const matriz = [{ tipo: "encabezado", valores: encabezados }, ...filas];
    if (matriz.length > 1048576) throw new Error("El resumen por subtipos supera el límite de filas de Excel.");
    const columnas = encabezados.length;
    const filasXml = matriz.map((fila, idx) => {
      const filaNumero = idx + 1;
      const valores = fila.valores || [];
      const estilo = fila.tipo === "encabezado" ? estilos.headerStyle : fila.tipo === "subtotal" || fila.tipo === "total" ? estilos.subtotalStyle : null;
      const celdas = Array.from({ length: columnas }, (_, col) => {
        const valor = valores[col], ref = `${nombreColumna(col + 1)}${filaNumero}`, estiloAttr = estilo == null ? "" : ` s="${estilo}"`;
        if (valor == null || valor === "") return `<c r="${ref}"${estiloAttr}/>`;
        if (typeof valor === "number" && Number.isFinite(valor)) return `<c r="${ref}"${estiloAttr}><v>${valor}</v></c>`;
        return `<c r="${ref}"${estiloAttr} t="inlineStr"><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
      }).join("");
      const alto = fila.tipo === "encabezado" ? 32 : fila.tipo === "subtotal" || fila.tipo === "total" ? 23 : 20;
      return `<row r="${filaNumero}" ht="${alto}" customHeight="1">${celdas}</row>`;
    }).join("");
    const anchosXml = (datos.anchos || encabezados.map(() => 18)).map((ancho, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${Math.max(8, Math.min(60, Number(ancho) || 18)).toFixed(2)}" customWidth="1"/>`).join("");
    const ultimaColumna = nombreColumna(columnas), ultimaFila = matriz.length;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${ultimaColumna}${ultimaFila}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${anchosXml}</cols><sheetData>${filasXml}</sheetData><autoFilter ref="A1:${ultimaColumna}${ultimaFila}"/><printOptions gridLines="0"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  }

  function generarLibroDesdeTabla(tablaResumen, detalle, resumenSubtipos) {
    const encabezados = detalle?.encabezados || [], registros = detalle?.filas || [];
    if (!encabezados.length) throw new Error("No se definieron las columnas del detalle.");
    if (!resumenSubtipos?.encabezados?.length) throw new Error("No se definieron las columnas del resumen por Subtipo 1 y Subtipo 2.");
    const resumen = leerZipXlsx(generarDesdeTabla(tablaResumen));
    const estilos = agregarEstilosResumenSubtipos(resumen.get("xl/styles.xml"));
    const filasDetalle = [{ altoPx: 34, celdas: encabezados.map(texto => ({ texto: String(texto ?? "") })) }];
    registros.forEach(registro => filasDetalle.push({ altoPx: 30, celdas: registro.map(texto => ({ texto: String(texto ?? "") })) }));
    const anchosDetalle = detalle.anchos || encabezados.map(() => 22);
    const detalleLibro = leerZipXlsx(generarXlsx({ filas: filasDetalle, anchos: anchosDetalle }));
    let detalleXml = detalleLibro.get("xl/worksheets/sheet1.xml").replace(/\s+s="\d+"/g, "");
    detalleXml = detalleXml.replace('<pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A4" sqref="A4"/>', '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>');

    const contenido = resumen.get("[Content_Types].xml").replace(
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    );
    const libro = resumen.get("xl/workbook.xml").replace(
      '<sheets><sheet name="Resumen V2" sheetId="1" r:id="rId1"/></sheets>',
      '<sheets><sheet name="Resumen V2" sheetId="1" r:id="rId1"/><sheet name="Resumen subtipos" sheetId="2" r:id="rId2"/><sheet name="Detalle guías" sheetId="3" r:id="rId3"/></sheets>'
    );
    const relaciones = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    return zipSinCompresion([
      { nombre: "[Content_Types].xml", contenido },
      { nombre: "_rels/.rels", contenido: resumen.get("_rels/.rels") },
      { nombre: "xl/workbook.xml", contenido: libro },
      { nombre: "xl/_rels/workbook.xml.rels", contenido: relaciones },
      { nombre: "xl/styles.xml", contenido: estilos.xml },
      { nombre: "xl/worksheets/sheet1.xml", contenido: resumen.get("xl/worksheets/sheet1.xml") },
      { nombre: "xl/worksheets/sheet2.xml", contenido: crearHojaResumenSubtiposXml(resumenSubtipos, estilos) },
      { nombre: "xl/worksheets/sheet3.xml", contenido: detalleXml }
    ]);
  }

  return { generarXlsx, generarDesdeTabla, generarLibroDesdeTabla };
});
