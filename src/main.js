import { IfcViewer } from "./viewer.js";
import { detectarVentanas } from "./ifc-windows.js";
import { calcularPorTipo, ANCHO_MAX_NAVE } from "./calculo.js";
import { REGIONES } from "./nsr10.js";
import { generarHTML, generarCSV, descargar, resumen, MSG_VER_EN_MODELO } from "./report.js";

const WASM_PATH = "https://cdn.jsdelivr.net/npm/web-ifc@0.0.68/";

const $ = (id) => document.getElementById(id);

let viewer;
let resultados = [];
// Caché de ventanas detectadas para el modelo cargado (evita releer el IFC en cada click).
let ventanasCache = null;
// Ventana del informe (hija): desde ella llegan los mensajes "Ver en modelo".
let reportWindow = null;

/** Resalta y encuadra en el 3D las ventanas del resultado i (null = todas). */
function verEnModelo(i) {
  if (!viewer || viewer.modelID < 0) return;
  let ids;
  if (i == null) ids = ventanas().map((v) => v.expressID);
  else if (resultados[i]) ids = ventanasDeResultado(resultados[i]);
  if (!ids || !ids.length) return;
  viewer.selectMany(ids);
  viewer.frameObjects(ids, "iso", 1.3);
  const cont = $("tabla");
  cont.querySelectorAll("tr").forEach((x) => x.classList.remove("active"));
  if (i != null) {
    const tr = cont.querySelector(`tr[data-i="${i}"]`);
    if (tr) {
      tr.classList.add("active");
      tr.scrollIntoView({ block: "nearest" });
    }
  }
  try {
    window.focus();
  } catch (e) {
    /* noop */
  }
}

window.addEventListener("message", (e) => {
  // Solo se aceptan mensajes de la ventana de informe abierta por esta app.
  if (!reportWindow || e.source !== reportWindow) return;
  const d = e.data;
  if (!d || d.type !== MSG_VER_EN_MODELO) return;
  verEnModelo(typeof d.i === "number" && Number.isFinite(d.i) ? d.i : null);
});

function ventanas() {
  if (!ventanasCache) ventanasCache = detectarVentanas(viewer);
  return ventanasCache;
}

function poblarCiudades() {
  $("ciudad").innerHTML = REGIONES.map(
    (r) => `<option value="${r.id}">${r.ciudad}</option>`
  ).join("");
  // por defecto Bogotá
  $("ciudad").value = "Region 2 - Bogota";
}

function leerParametros() {
  return {
    alturaEdificioM: parseFloat($("altura").value) || 10,
    region: $("ciudad").value,
    tipoVidrio: $("tipo-lam").checked ? "laminado" : "monolitico",
    factorVidrio: (parseFloat($("factor").value) || 90) / 100,
    anchoMaxNave: parseFloat($("nave").value) || ANCHO_MAX_NAVE,
  };
}

function setStatus(msg, cls = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = "status " + cls;
}

async function cargarIFC(file) {
  const t0 = performance.now();
  setStatus(`Leyendo ${file.name}…`, "load");
  $("btn-calcular").setAttribute("disabled", "");
  $("btn-html").setAttribute("disabled", "");
  $("btn-csv").setAttribute("disabled", "");
  resultados = [];
  ventanasCache = null;
  renderTabla();
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    await viewer.loadIFC(buffer, (fase, hecho, total) => {
      if (fase === "parse") setStatus(`Analizando ${file.name}…`, "load");
      else if (fase === "tessellate") setStatus("Generando geometría (web-ifc)…", "load");
      else if (fase === "build")
        setStatus(`Construyendo modelo 3D… ${Math.round((hecho / total) * 100)}% (${hecho}/${total})`, "load");
    });
    const n = ventanas().length;
    const seg = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus(
      `Modelo cargado en ${seg} s · ${viewer.elementos.size} elementos · ${n} ventanas detectadas`,
      "ok"
    );
    $("btn-calcular").removeAttribute("disabled");
  } catch (e) {
    console.error(e);
    setStatus("Error al cargar el IFC. Ver consola.", "fail");
  }
}

function calcular() {
  const p = leerParametros();
  const vs = ventanas();
  if (vs.length === 0) {
    setStatus("No se detectaron IfcWindow en el modelo.", "fail");
    return;
  }
  resultados = calcularPorTipo(vs, p);
  renderTabla();
  const r = resumen(resultados);
  setStatus(
    `${r.totalVentanas} ventanas · ${r.totalTipos} tipos · ${r.noCumplen.length} a revisar · presión ${resultados[0].presion.toFixed(
      2
    )} kPa`,
    r.noCumplen.length ? "warn" : "ok"
  );
  $("btn-html").removeAttribute("disabled");
  $("btn-csv").removeAttribute("disabled");
}

function renderTabla() {
  const cont = $("tabla");
  if (!resultados.length) {
    cont.innerHTML = "";
    return;
  }
  const rows = resultados
    .map((r, i) => {
      const badge = r.cumple
        ? `<span class="pill ok">OK</span>`
        : `<span class="pill fail">REVISAR</span>`;
      return `<tr data-i="${i}" class="rowsel ${r.cumple ? "" : "rf"}">
        <td>${r.tipo}</td>
        <td>${r.ancho.toFixed(2)}×${r.alto.toFixed(2)}</td>
        <td>${r.cantidad}</td>
        <td>${r.navesX}</td>
        <td>${r.areaHoja.toFixed(2)}</td>
        <td><b>${r.espesor.espesorMM ?? "-"}</b> <span class="dim">${r.espesor.composicion}</span></td>
        <td>${badge}</td>
      </tr>`;
    })
    .join("");
  cont.innerHTML = `<table class="mini">
    <thead><tr><th>Tipo</th><th>A×H (m)</th><th>Cant</th><th>Naves</th><th>Hoja m²</th><th>Espesor</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;

  cont.querySelectorAll("tr.rowsel").forEach((tr) => {
    tr.addEventListener("click", () => {
      const i = parseInt(tr.dataset.i);
      viewer.selectMany(ventanasDeResultado(resultados[i]));
      cont.querySelectorAll("tr").forEach((x) => x.classList.remove("active"));
      tr.classList.add("active");
    });
  });
}

function ventanasDeResultado(r) {
  return ventanas()
    .filter(
      (v) =>
        v.tipo === r.tipo &&
        Math.abs(v.ancho - r.ancho) < 0.005 &&
        Math.abs(v.alto - r.alto) < 0.005
    )
    .map((v) => v.expressID);
}

/**
 * Captura las vistas 3D del informe en dos lotes (generales en alta, miniaturas por tipo en baja).
 * JPEG en vez de PNG y pixel ratio 1: cada imagen pesa y tarda una fracción.
 */
async function capturarVistas(onProgress) {
  const todas = ventanas().map((v) => v.expressID);
  const imagenes = { porTipo: {} };
  const conMiniaturas = $("chk-mini").checked;
  try {
    const generales = [{ ids: null }];
    if (todas.length) generales.push({ ids: todas, ghost: true });
    const porTipo = [];
    if (conMiniaturas)
      resultados.forEach((r, i) => {
        const ids = ventanasDeResultado(r);
        // vecindad: solo se dibuja el entorno cercano de esas ventanas (no todo el edificio)
        if (ids.length) porTipo.push({ i, ids, ghost: true, pad: 1.1, vecindad: 2 });
      });
    const total = generales.length + porTipo.length;

    let t0 = performance.now();
    const g = await viewer.captureLote(generales, {
      width: 1200,
      height: 780,
      quality: 0.85,
      onProgress: (k) => onProgress(k, total),
    });
    console.info(`[informe] vistas generales: ${g.length} en ${Math.round(performance.now() - t0)} ms`);
    imagenes.full = g[0];
    if (g[1]) imagenes.ventanas = g[1];

    if (porTipo.length) {
      // tamaño adaptativo: con muchos tipos, miniaturas más pequeñas para acotar el tiempo total
      const n = porTipo.length;
      const [w, h] = n <= 30 ? [800, 540] : n <= 80 ? [640, 432] : [480, 324];
      t0 = performance.now();
      const t = await viewer.captureLote(porTipo, {
        width: w,
        height: h,
        quality: 0.8,
        onProgress: (k) => onProgress(generales.length + k, total),
      });
      console.info(
        `[informe] miniaturas por tipo: ${n} (${w}×${h}) en ${Math.round(performance.now() - t0)} ms`
      );
      porTipo.forEach((p, k) => (imagenes.porTipo[p.i] = t[k]));
    }
  } catch (e) {
    console.warn("No se pudieron capturar vistas 3D:", e);
  }
  return imagenes;
}

async function generarInforme() {
  const btn = $("btn-html");
  btn.setAttribute("disabled", "");
  const t0 = performance.now();
  // Abrir la ventana de inmediato (dentro del gesto del usuario) para evitar el bloqueador de popups.
  const w = window.open("", "_blank");
  reportWindow = w;
  if (w) {
    w.document.write(
      `<!doctype html><title>Informe de Ventanería NSR-10</title>
       <body style="font-family:Segoe UI,Arial,sans-serif;color:#555;padding:40px">
       <h2 style="margin:0 0 8px;color:#0d5cab;font-size:18px">Generando informe…</h2>
       <div id="prog">Preparando vistas 3D</div>
       <div style="margin-top:14px;height:6px;background:#eee;border-radius:3px;overflow:hidden;max-width:420px"><div id="bar" style="height:100%;width:0;background:#0d5cab;transition:width .15s"></div></div>
       </body>`
    );
    w.document.close();
  }
  // Al abrirse el informe, esta pestaña queda oculta: el progreso se muestra en la ventana del informe.
  const progreso = (k, n) => {
    setStatus(`Generando vistas 3D para el informe… ${k}/${n}`, "load");
    try {
      if (w && !w.closed) {
        const p = w.document.getElementById("prog");
        const b = w.document.getElementById("bar");
        if (p) p.textContent = `Vista 3D ${k} de ${n}`;
        if (b) b.style.width = `${Math.round((k / n) * 100)}%`;
      }
    } catch (e) {
      /* noop */
    }
  };
  try {
    setStatus("Generando vistas 3D para el informe…", "load");
    const imagenes = await capturarVistas(progreso);
    const html = generarHTML(resultados, leerParametros(), imagenes);
    if (w && !w.closed) {
      w.document.open();
      w.document.write(html);
      w.document.close();
    } else {
      descargar("informe-ventaneria.html", html, "text/html");
    }
    setStatus(`Informe generado en ${((performance.now() - t0) / 1000).toFixed(1)} s.`, "ok");
  } catch (e) {
    console.error(e);
    setStatus("Error al generar el informe. Ver consola.", "fail");
  } finally {
    btn.removeAttribute("disabled");
  }
}

// --- Panel redimensionable --------------------------------------------------
function initPanelResizable() {
  const panel = $("panel");
  const params = $("params");
  const paramsBody = params.querySelector(".params-body");
  const LS_W = "nsr10.panelW";
  const LS_P = "nsr10.paramsCollapsed";

  // ancho guardado
  try {
    const w = parseInt(localStorage.getItem(LS_W));
    if (w) panel.style.width = w + "px";
    if (localStorage.getItem(LS_P) === "1") params.classList.add("collapsed");
  } catch (e) {
    /* noop */
  }

  // colapsar / expandir parámetros (click en el título)
  params.querySelector("h2").addEventListener("click", () => {
    params.classList.toggle("collapsed");
    paramsBody.style.maxHeight = "";
    try {
      localStorage.setItem(LS_P, params.classList.contains("collapsed") ? "1" : "0");
    } catch (e) {
      /* noop */
    }
  });

  // arrastre genérico con pointer events
  const drag = (handle, onStart, onMove) => {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      document.body.classList.add("resizing");
      const st = onStart(e);
      const move = (ev) => onMove(ev, st);
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        handle.classList.remove("dragging");
        document.body.classList.remove("resizing");
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  };

  // divisor vertical: ancho del panel
  drag(
    $("vsplit"),
    (e) => ({ x: e.clientX, w: panel.getBoundingClientRect().width }),
    (e, st) => {
      const max = Math.min(window.innerWidth * 0.85, window.innerWidth - 240);
      const w = Math.max(320, Math.min(max, st.w + (e.clientX - st.x)));
      panel.style.width = w + "px";
      viewer.onResize();
      try {
        localStorage.setItem(LS_W, String(Math.round(w)));
      } catch (err) {
        /* noop */
      }
    }
  );

  // divisor horizontal: reparte altura entre parámetros y resultados
  drag(
    $("hsplit"),
    (e) => {
      if (params.classList.contains("collapsed")) {
        params.classList.remove("collapsed");
        paramsBody.style.maxHeight = "0px";
      }
      return { y: e.clientY, h: paramsBody.getBoundingClientRect().height };
    },
    (e, st) => {
      const natural = paramsBody.scrollHeight;
      const h = Math.max(0, Math.min(natural, st.h + (e.clientY - st.y)));
      paramsBody.style.maxHeight = h + "px";
    }
  );

  // doble click en el divisor: restablecer
  $("vsplit").addEventListener("dblclick", () => {
    panel.style.width = "";
    try {
      localStorage.removeItem(LS_W);
    } catch (e) {
      /* noop */
    }
  });
  $("hsplit").addEventListener("dblclick", () => {
    paramsBody.style.maxHeight = "";
    params.classList.remove("collapsed");
  });

  // el visor debe seguir el tamaño real del contenedor
  if (window.ResizeObserver) {
    new ResizeObserver(() => viewer.onResize()).observe($("viewport"));
  }
}

function init() {
  viewer = new IfcViewer($("viewport"));
  window.__viewer = viewer; // hook de depuración
  poblarCiudades();
  initPanelResizable();

  viewer
    .init(WASM_PATH)
    .then(() => setStatus("Listo. Cargue un archivo IFC.", ""))
    .catch((e) => {
      console.error(e);
      setStatus("No se pudo inicializar web-ifc (¿sin conexión?).", "fail");
    });

  $("file").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) cargarIFC(f);
    e.target.value = "";
  });

  const vp = $("viewport");
  vp.addEventListener("dragover", (e) => {
    e.preventDefault();
    vp.classList.add("drop");
  });
  vp.addEventListener("dragleave", () => vp.classList.remove("drop"));
  vp.addEventListener("drop", (e) => {
    e.preventDefault();
    vp.classList.remove("drop");
    const f = e.dataTransfer?.files?.[0];
    if (f && f.name.toLowerCase().endsWith(".ifc")) cargarIFC(f);
  });

  $("btn-calcular").addEventListener("click", calcular);
  $("btn-html").addEventListener("click", generarInforme);
  $("btn-csv").addEventListener("click", () =>
    descargar("ventaneria-nsr10.csv", generarCSV(resultados), "text/csv")
  );
}

init();
