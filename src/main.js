import { IfcViewer } from "./viewer.js";
import { detectarVentanas } from "./ifc-windows.js";
import { calcularPorTipo, ANCHO_MAX_NAVE } from "./calculo.js";
import { REGIONES } from "./nsr10.js";
import { generarHTML, generarCSV, descargar, resumen } from "./report.js";

const WASM_PATH = "https://unpkg.com/web-ifc@0.0.68/";

const $ = (id) => document.getElementById(id);

let viewer;
let resultados = [];

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
  setStatus(`Cargando ${file.name}…`, "load");
  const buffer = new Uint8Array(await file.arrayBuffer());
  try {
    await viewer.loadIFC(buffer);
    const n = detectarVentanas(viewer).length;
    setStatus(
      `Modelo cargado · ${viewer.elementos.size} elementos · ${n} ventanas detectadas`,
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
  const ventanas = detectarVentanas(viewer);
  if (ventanas.length === 0) {
    setStatus("No se detectaron IfcWindow en el modelo.", "fail");
    return;
  }
  resultados = calcularPorTipo(ventanas, p);
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
      const r = resultados[i];
      const ventanas = detectarVentanas(viewer).filter(
        (v) =>
          v.tipo === r.tipo &&
          Math.abs(v.ancho - r.ancho) < 0.005 &&
          Math.abs(v.alto - r.alto) < 0.005
      );
      viewer.selectMany(ventanas.map((v) => v.expressID));
      cont.querySelectorAll("tr").forEach((x) => x.classList.remove("active"));
      tr.classList.add("active");
    });
  });
}

function ventanasDeResultado(r) {
  return detectarVentanas(viewer)
    .filter(
      (v) =>
        v.tipo === r.tipo &&
        Math.abs(v.ancho - r.ancho) < 0.005 &&
        Math.abs(v.alto - r.alto) < 0.005
    )
    .map((v) => v.expressID);
}

function capturarVistas() {
  const todasVentanas = detectarVentanas(viewer).map((v) => v.expressID);
  const imagenes = { porTipo: {} };
  try {
    imagenes.full = viewer.captureVista(null, "iso");
    if (todasVentanas.length)
      imagenes.ventanas = viewer.captureVista(todasVentanas, "iso", { ghost: true });
    resultados.forEach((r, i) => {
      const ids = ventanasDeResultado(r);
      if (ids.length)
        imagenes.porTipo[i] = viewer.captureVista(ids, "iso", { ghost: true, pad: 1.1 });
    });
  } catch (e) {
    console.warn("No se pudieron capturar vistas 3D:", e);
  }
  return imagenes;
}

function init() {
  viewer = new IfcViewer($("viewport"));
  window.__viewer = viewer; // hook de depuración
  poblarCiudades();

  viewer.init(WASM_PATH).then(() => setStatus("Listo. Cargue un archivo IFC.", ""));

  $("file").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) cargarIFC(f);
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
  $("btn-html").addEventListener("click", () => {
    setStatus("Generando vistas 3D para el informe…", "load");
    // permitir que el navegador pinte el estado antes del renderizado pesado
    setTimeout(() => {
      const imagenes = capturarVistas();
      const html = generarHTML(resultados, leerParametros(), imagenes);
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
      } else {
        descargar("informe-ventaneria.html", html, "text/html");
      }
      setStatus("Informe generado.", "ok");
    }, 60);
  });
  $("btn-csv").addEventListener("click", () =>
    descargar("ventaneria-nsr10.csv", generarCSV(resultados), "text/csv")
  );
}

init();
