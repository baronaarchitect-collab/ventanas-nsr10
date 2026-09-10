/**
 * Generación del informe de ventanería (similar al cuadro de ventanas del proyecto)
 * y exportación a HTML imprimible (PDF) y CSV.
 */
import { REGIONES } from "./nsr10.js";

function ciudadDe(p) {
  return REGIONES.find((r) => r.id === p.region)?.ciudad ?? p.region;
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
        ? `<img class="zoom" src="${imagenes.porTipo[i]}" alt="3D ${r.tipo}">`
        : "";
      return `<tr class="${r.cumple ? "" : "row-fail"}">
        <td>${i + 1}</td>
        <td>${zoom}</td>
        <td>${r.tipo}</td>
        <td>${r.ancho.toFixed(2)}</td>
        <td>${r.alto.toFixed(2)}</td>
        <td>${r.cantidad}</td>
        <td>${r.areaBruta.toFixed(2)}</td>
        <td>${r.navesX}</td>
        <td>${r.anchoNave.toFixed(2)}</td>
        <td>${r.areaHoja.toFixed(2)}</td>
        <td><b>${r.espesor.espesorMM ?? "-"}</b></td>
        <td>${r.espesor.composicion}</td>
        <td>${r.espesor.areaMaxTabla?.toFixed(2) ?? "-"}</td>
        <td>${estado}</td>
      </tr>`;
    })
    .join("\n");

  const vistasHTML =
    imagenes.full || imagenes.ventanas
      ? `<div class="vistas">
      ${imagenes.full ? `<figure><img src="${imagenes.full}" alt="Modelo IFC completo"><figcaption>Modelo IFC completo (con ejes)</figcaption></figure>` : ""}
      ${imagenes.ventanas ? `<figure><img src="${imagenes.ventanas}" alt="Solo ventanas"><figcaption>Filtrado: solo ventanas</figcaption></figure>` : ""}
    </div>`
      : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Informe de Ventanería NSR-10</title>
<style>
  body{font-family:Segoe UI,Arial,sans-serif;color:#1a1d21;margin:32px;font-size:12px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:#666;margin-bottom:16px}
  .cards{display:flex;gap:12px;margin:16px 0;flex-wrap:wrap}
  .card{border:1px solid #ddd;border-radius:8px;padding:12px 16px;min-width:130px}
  .card .k{color:#888;font-size:11px;text-transform:uppercase}
  .card .v{font-size:20px;font-weight:700}
  table{border-collapse:collapse;width:100%;margin-top:8px}
  th,td{border:1px solid #cfd4da;padding:5px 7px;text-align:center}
  th{background:#0d5cab;color:#fff;font-size:11px}
  tr:nth-child(even){background:#f5f7fa}
  .row-fail{background:#fdecec !important}
  .ok{color:#0a7d33;font-weight:700}
  .fail{color:#c0271b;font-weight:700}
  .params{background:#eef3fa;border:1px solid #cdd9ea;border-radius:8px;padding:12px 16px;margin:12px 0}
  .params b{color:#0d5cab}
  .foot{margin-top:24px;color:#888;font-size:10px;border-top:1px solid #ddd;padding-top:8px}
  .vistas{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0}
  .vistas figure{margin:0;flex:1;min-width:320px}
  .vistas img{width:100%;border:1px solid #cfd4da;border-radius:8px;background:#16181c}
  .vistas figcaption{font-size:11px;color:#666;margin-top:4px;text-align:center}
  img.zoom{width:74px;height:52px;object-fit:cover;border:1px solid #cfd4da;border-radius:5px;background:#16181c}
  @media print{body{margin:10px}}
</style></head><body>
<h1>Informe de Ventanería — NSR-10 (Título K.4)</h1>
<div class="sub">Verificación de espesor de vidrio por área y presión de viento · generado ${fecha}</div>

<div class="params">
  <b>Ciudad / Región:</b> ${ciudadDe(p)} &nbsp;·&nbsp;
  <b>Altura de instalación:</b> ${p.alturaEdificioM.toFixed(1)} m &nbsp;·&nbsp;
  <b>Presión de viento:</b> ${presion.toFixed(2)} kPa &nbsp;·&nbsp;
  <b>Tipo de vidrio:</b> ${p.tipoVidrio} &nbsp;·&nbsp;
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

<table>
  <thead><tr>
    <th>#</th><th>3D</th><th>Tipo</th><th>Ancho (m)</th><th>Alto (m)</th><th>Cant.</th>
    <th>Área bruta (m²)</th><th>Naves</th><th>Ancho nave (m)</th>
    <th>Área hoja (m²)</th><th>Espesor (mm)</th><th>Composición</th>
    <th>Área máx. tabla (m²)</th><th>Estado</th>
  </tr></thead>
  <tbody>
${filas}
  </tbody>
</table>

<div class="foot">
  Cálculo según NSR-10 Título K (K.4 Vidrio y ventanería). Vidrios soportados por 4 lados,
  totalmente enmarcados. Presión de viento interpolada por altura y ciudad (Factor de importancia II,
  categoría de exposición C). Laminado según tabla ASTM E-1300 (Vidrio Laminado LG);
  monolítico/templado según Tabla K.4.3-1.
</div>
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
