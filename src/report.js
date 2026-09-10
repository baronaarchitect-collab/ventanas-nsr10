/**
 * Generación del informe de ventanería (similar al cuadro de ventanas del proyecto)
 * y exportación a HTML imprimible (PDF) y CSV.
 *
 * El informe se abre en una ventana hija de la app: cada fila tiene un botón "Ver en modelo"
 * que envía un postMessage a la app (window.opener) para resaltar y encuadrar esas ventanas.
 */
import { REGIONES } from "./nsr10.js";

export const MSG_VER_EN_MODELO = "nsr10:ver-en-modelo";

function ciudadDe(p) {
  return REGIONES.find((r) => r.id === p.region)?.ciudad ?? p.region;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function resumen(resultados) {
  const totalTipos = resultados.length;
  const totalVentanas = resultados.reduce((s, r) => s + r.cantidad, 0);
  const noCumplen = resultados.filter((r) => !r.cumple);
  const areaTotal = resultados.reduce((s, r) => s + r.areaBruta * r.cantidad, 0);
  return { totalTipos, totalVentanas, noCumplen, areaTotal };
}

export function generarHTML(resultados, p, imagenes = {}) {
  const { totalTipos, totalVentanas, noCumplen, areaTotal } = resumen(resultados);
  const fecha = new Date().toLocaleString("es-CO");
  const presion = resultados[0]?.presion ?? 0;

  const filas = resultados
    .map((r, i) => {
      const estado = r.cumple
        ? `<span class="ok">CUMPLE</span>`
        : `<span class="fail">REVISAR</span>`;
      const zoom = imagenes.porTipo?.[i]
        ? `<img class="zoom" src="${imagenes.porTipo[i]}" alt="3D ${esc(r.tipo)}" data-titulo="${esc(r.tipo)} · ${r.ancho.toFixed(2)}×${r.alto.toFixed(2)} m" title="Clic para ampliar">`
        : "";
      return `<tr class="${r.cumple ? "" : "row-fail"}" data-i="${i}">
        <td>${i + 1}</td>
        <td>${zoom}</td>
        <td class="tipo">${esc(r.tipo)}</td>
        <td>${r.ancho.toFixed(2)}</td>
        <td>${r.alto.toFixed(2)}</td>
        <td>${r.cantidad}</td>
        <td>${r.areaBruta.toFixed(2)}</td>
        <td>${r.navesX}</td>
        <td>${r.anchoNave.toFixed(2)}</td>
        <td>${r.areaHoja.toFixed(2)}</td>
        <td><b>${r.espesor.espesorMM ?? "-"}</b></td>
        <td>${esc(r.espesor.composicion)}</td>
        <td>${r.espesor.areaMaxTabla?.toFixed(2) ?? "-"}</td>
        <td>${estado}</td>
        <td class="acc"><button class="ver" data-i="${i}" title="Resaltar estas ventanas en el modelo 3D">🎯 Ver en modelo</button></td>
      </tr>`;
    })
    .join("\n");

  const vistasHTML =
    imagenes.full || imagenes.ventanas
      ? `<div class="vistas">
      ${imagenes.full ? `<figure><img src="${imagenes.full}" alt="Modelo IFC completo" data-titulo="Modelo IFC completo" title="Clic para ampliar"><figcaption>Modelo IFC completo (con ejes)</figcaption></figure>` : ""}
      ${imagenes.ventanas ? `<figure><img src="${imagenes.ventanas}" alt="Solo ventanas" data-titulo="Filtrado: solo ventanas" title="Clic para ampliar"><figcaption>Filtrado: solo ventanas</figcaption></figure>` : ""}
    </div>`
      : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Informe de Ventanería NSR-10</title>
<style>
  body{font-family:Segoe UI,Arial,sans-serif;color:#1a1d21;margin:0;font-size:12px;background:#fff}
  .wrap{padding:0 32px 32px}
  .top{position:sticky;top:0;z-index:20;background:#fff;border-bottom:2px solid #0d5cab;padding:14px 32px 10px;
       display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
  h1{font-size:20px;margin:0 0 2px}
  .sub{color:#666}
  .acciones{display:flex;gap:8px}
  .acciones button{background:#0d5cab;color:#fff;border:none;border-radius:6px;padding:7px 12px;cursor:pointer;font-size:12px}
  .acciones button.sec{background:#eef3fa;color:#0d5cab;border:1px solid #cdd9ea}
  .acciones button:hover{filter:brightness(1.08)}
  .cards{display:flex;gap:12px;margin:16px 0;flex-wrap:wrap}
  .card{border:1px solid #ddd;border-radius:8px;padding:12px 16px;min-width:130px}
  .card .k{color:#888;font-size:11px;text-transform:uppercase}
  .card .v{font-size:20px;font-weight:700}
  /* sin overflow en el contenedor: el thead pegajoso debe fijarse respecto a la página */
  .tabla-wrap{margin-top:8px}
  table{border-collapse:separate;border-spacing:0;width:100%;min-width:980px}
  th,td{border-bottom:1px solid #cfd4da;border-right:1px solid #cfd4da;padding:5px 7px;text-align:center}
  th:first-child,td:first-child{border-left:1px solid #cfd4da}
  th{background:#0d5cab;color:#fff;font-size:11px;position:sticky;top:var(--top-h,70px);z-index:10;border-top:1px solid #0d5cab}
  tbody tr:nth-child(even){background:#f5f7fa}
  tbody tr:hover{background:#eaf1fb}
  tbody tr.sel td{background:#fff3e0}
  .row-fail td{background:#fdecec}
  td.tipo{text-align:left;font-weight:600}
  .ok{color:#0a7d33;font-weight:700}
  .fail{color:#c0271b;font-weight:700}
  .params{background:#eef3fa;border:1px solid #cdd9ea;border-radius:8px;padding:12px 16px;margin:16px 0 12px}
  .params b{color:#0d5cab}
  .foot{margin-top:24px;color:#888;font-size:10px;border-top:1px solid #ddd;padding-top:8px}
  .vistas{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0}
  .vistas figure{margin:0;flex:1;min-width:320px}
  .vistas img{width:100%;border:1px solid #cfd4da;border-radius:8px;background:#16181c;cursor:zoom-in}
  .vistas figcaption{font-size:11px;color:#666;margin-top:4px;text-align:center}
  img.zoom{width:74px;height:52px;object-fit:cover;border:1px solid #cfd4da;border-radius:5px;background:#16181c;cursor:zoom-in;display:block;margin:auto}
  img.zoom:hover,.vistas img:hover{outline:2px solid #2f8fed}
  button.ver{background:#fff;color:#0d5cab;border:1px solid #0d5cab;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;white-space:nowrap}
  button.ver:hover{background:#0d5cab;color:#fff}
  button.ver:disabled{opacity:.35;cursor:not-allowed}
  .aviso{display:none;background:#fff8e1;border:1px solid #f2d27a;color:#7a5a00;border-radius:6px;padding:8px 12px;margin:8px 0}
  /* visor de imagen ampliada */
  #lb{position:fixed;inset:0;background:rgba(10,12,16,.9);display:none;align-items:center;justify-content:center;z-index:100;flex-direction:column;gap:10px;cursor:zoom-out}
  #lb.on{display:flex}
  #lb img{max-width:96vw;max-height:88vh;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.6);cursor:default}
  #lb .cap{color:#e6e9ec;font-size:13px}
  #lb .x{position:absolute;top:14px;right:18px;color:#fff;font-size:26px;cursor:pointer;background:none;border:none}
  @media print{
    .top{position:static;border-bottom:1px solid #999;padding:0 0 8px}
    .acciones,.acc,th.acc,#lb,.aviso{display:none !important}
    th{position:static}
    .wrap{padding:0}
    body{margin:10px}
    .tabla-wrap{overflow:visible}
  }
</style></head><body>
<div class="top" id="top">
  <div>
    <h1>Informe de Ventanería — NSR-10 (Título K.4)</h1>
    <div class="sub">Verificación de espesor de vidrio por área y presión de viento · generado ${fecha}</div>
  </div>
  <div class="acciones">
    <button class="sec" id="btn-todas" title="Resaltar todas las ventanas en el modelo 3D">🎯 Ver todas en modelo</button>
    <button onclick="window.print()">🖨 Imprimir / PDF</button>
  </div>
</div>
<div class="wrap">
<div class="aviso" id="aviso">Este informe no está conectado a la aplicación (se abrió como archivo). Los botones "Ver en modelo" están deshabilitados.</div>

<div class="params">
  <b>Ciudad / Región:</b> ${esc(ciudadDe(p))} &nbsp;·&nbsp;
  <b>Altura de instalación:</b> ${p.alturaEdificioM.toFixed(1)} m &nbsp;·&nbsp;
  <b>Presión de viento:</b> ${presion.toFixed(2)} kPa &nbsp;·&nbsp;
  <b>Tipo de vidrio:</b> ${esc(p.tipoVidrio)} &nbsp;·&nbsp;
  <b>Ancho máx. de nave:</b> ${p.anchoMaxNave.toFixed(2)} m &nbsp;·&nbsp;
  <b>Factor de vidrio:</b> ${(p.factorVidrio * 100).toFixed(0)}%
</div>

<div class="cards">
  <div class="card"><div class="k">Tipos</div><div class="v">${totalTipos}</div></div>
  <div class="card"><div class="k">Ventanas</div><div class="v">${totalVentanas}</div></div>
  <div class="card"><div class="k">Área total</div><div class="v">${areaTotal.toFixed(1)} m²</div></div>
  <div class="card"><div class="k">A revisar</div><div class="v" style="color:${
    noCumplen.length ? "#c0271b" : "#0a7d33"
  }">${noCumplen.length}</div></div>
</div>

${vistasHTML}

<div class="tabla-wrap">
<table>
  <thead><tr>
    <th>#</th><th>3D</th><th>Tipo</th><th>Ancho (m)</th><th>Alto (m)</th><th>Cant.</th>
    <th>Área bruta (m²)</th><th>Naves</th><th>Ancho nave (m)</th>
    <th>Área hoja (m²)</th><th>Espesor (mm)</th><th>Composición</th>
    <th>Área máx. tabla (m²)</th><th>Estado</th><th class="acc">Modelo</th>
  </tr></thead>
  <tbody>
${filas}
  </tbody>
</table>
</div>

<div class="foot">
  Cálculo según NSR-10 Título K (K.4 Vidrio y ventanería). Vidrios soportados por 4 lados,
  totalmente enmarcados. Presión de viento interpolada por altura y ciudad (Factor de importancia II,
  categoría de exposición C). Laminado según tabla ASTM E-1300 (Vidrio Laminado LG);
  monolítico/templado según Tabla K.4.3-1.
</div>
</div>

<div id="lb"><button class="x" title="Cerrar">✕</button><img alt=""><div class="cap"></div></div>

<script>
(function(){
  var MSG = ${JSON.stringify(MSG_VER_EN_MODELO)};
  // altura real del encabezado fijo -> offset del thead pegajoso
  function ajustarTop(){
    var t = document.getElementById('top');
    document.documentElement.style.setProperty('--top-h', (t ? t.offsetHeight : 70) + 'px');
  }
  ajustarTop(); window.addEventListener('resize', ajustarTop); window.addEventListener('load', ajustarTop);
  if (window.ResizeObserver) new ResizeObserver(ajustarTop).observe(document.getElementById('top'));

  // visor de imagen ampliada
  var lb = document.getElementById('lb'), lbImg = lb.querySelector('img'), cap = lb.querySelector('.cap');
  function abrir(img){ lbImg.src = img.src; cap.textContent = img.getAttribute('data-titulo') || img.alt || ''; lb.classList.add('on'); }
  function cerrar(){ lb.classList.remove('on'); lbImg.src = ''; }
  document.querySelectorAll('img.zoom, .vistas img').forEach(function(img){ img.addEventListener('click', function(){ abrir(img); }); });
  lb.addEventListener('click', function(e){ if (e.target === lb || e.target.classList.contains('x')) cerrar(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') cerrar(); });

  // botones "Ver en modelo" -> app padre
  var app = window.opener;
  var conectado = false;
  try { conectado = !!(app && !app.closed); } catch (e) { conectado = false; }
  function enviar(i){
    if (!conectado) return;
    try { app.postMessage({ type: MSG, i: i }, '*'); app.focus(); } catch (e) { console.warn(e); }
    document.querySelectorAll('tbody tr').forEach(function(tr){ tr.classList.toggle('sel', i != null && tr.getAttribute('data-i') === String(i)); });
  }
  document.querySelectorAll('button.ver').forEach(function(b){
    b.disabled = !conectado;
    b.addEventListener('click', function(){ enviar(parseInt(b.getAttribute('data-i'))); });
  });
  var todas = document.getElementById('btn-todas');
  todas.disabled = !conectado;
  todas.addEventListener('click', function(){ enviar(null); });
  if (!conectado) document.getElementById('aviso').style.display = 'block';
})();
</script>
</body></html>`;
}

export function generarCSV(resultados) {
  const head = [
    "Tipo", "Ancho_m", "Alto_m", "Cantidad", "AreaBruta_m2", "Naves", "AnchoNave_m",
    "AreaHoja_m2", "Presion_kPa", "Espesor_mm", "Composicion", "AreaMaxTabla_m2", "Cumple", "Fuente",
  ];
  const rows = resultados.map((r) =>
    [
      r.tipo, r.ancho.toFixed(3), r.alto.toFixed(3), r.cantidad, r.areaBruta.toFixed(3),
      r.navesX, r.anchoNave.toFixed(3), r.areaHoja.toFixed(3), r.presion.toFixed(2),
      r.espesor.espesorMM ?? "", r.espesor.composicion, r.espesor.areaMaxTabla ?? "",
      r.cumple ? "SI" : "NO", r.espesor.fuente,
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [head.join(","), ...rows].join("\n");
}

export function descargar(nombre, contenido, mime) {
  const blob = new Blob([contenido], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}
