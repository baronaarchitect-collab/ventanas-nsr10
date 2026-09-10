/**
 * Motor de cálculo de ventanería según NSR-10.
 * Toma las ventanas detectadas en el IFC + parámetros del proyecto
 * (altura del edificio, ciudad, tipo de vidrio) y produce el resultado por tipo.
 */
import { presionViento, espesorLaminado, espesorMonolitico } from "./nsr10.js";

export const ANCHO_MAX_NAVE = 1.5; // m — ancho máximo de nave (hoja de vidrio)

/** Número de naves para respetar el ancho máximo de nave (subdivide en naves iguales). */
export function numeroDeNaves(ancho, anchoMax) {
  if (anchoMax <= 0) return 1;
  return Math.max(1, Math.ceil(ancho / anchoMax - 1e-9));
}

/** Calcula el resultado NSR-10 para una ventana/tipo. */
export function calcularVentana(v, p) {
  const presion = presionViento(p.region, p.alturaEdificioM);
  const naves = numeroDeNaves(v.ancho, p.anchoMaxNave);
  const anchoNave = v.ancho / naves;

  const areaBrutaNave = anchoNave * v.alto;
  const areaHoja =
    v.areaVidrio != null && naves === 1 ? v.areaVidrio : areaBrutaNave * p.factorVidrio;

  const espesor =
    p.tipoVidrio === "laminado" ? espesorLaminado(areaHoja, presion) : espesorMonolitico(areaHoja);

  return {
    tipo: v.tipo,
    ancho: v.ancho,
    alto: v.alto,
    cantidad: 1,
    ubicaciones: [],
    navesX: naves,
    anchoNave,
    areaBruta: v.ancho * v.alto,
    areaHoja,
    presion,
    espesor,
    cumple: espesor.cumple,
  };
}

/** Agrupa ventanas por (tipo + ancho + alto) y calcula el resultado por grupo. */
export function calcularPorTipo(ventanas, p) {
  const grupos = new Map();
  for (const v of ventanas) {
    const key = `${v.tipo}|${v.ancho.toFixed(3)}|${v.alto.toFixed(3)}`;
    const g = grupos.get(key);
    if (g) g.ids.push(v.expressID);
    else grupos.set(key, { v, ids: [v.expressID] });
  }

  const resultados = [];
  for (const { v, ids } of grupos.values()) {
    const r = calcularVentana(v, p);
    r.cantidad = ids.length;
    resultados.push(r);
  }
  resultados.sort((a, b) => {
    if (a.cumple !== b.cumple) return a.cumple ? 1 : -1;
    return a.tipo.localeCompare(b.tipo);
  });
  return resultados;
}
