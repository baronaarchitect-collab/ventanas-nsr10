/**
 * Tablas NSR-10 (Título K, Capítulo K.4 - Vidrio y ventanería)
 * Datos digitalizados a partir de:
 *   - Tabla K.4.3-1: Áreas máximas de vidrio de seguridad para vidrieras totalmente enmarcadas.
 *   - Tabla de presión de viento del proyecto (kN/m²) por altura de instalación y región/ciudad.
 *   - Tabla VIDRIO LAMINADO LG: área máxima (m²) según presión de viento y espesor.
 *
 * Aplica a vidrios SOPORTADOS POR 4 LADOS (totalmente enmarcados), relación largo/ancho <= 2,
 * bajo procedimiento ASTM E-1300 y NSR-10.
 */

// ---------------------------------------------------------------------------
// TABLA K.4.3-1 — Áreas máximas (m²) de vidrio de seguridad, vidrieras totalmente enmarcadas
// ---------------------------------------------------------------------------
export const AREA_MAX_TEMPLADO = [
  { espesor: 3, areaMax: 1.0 },
  { espesor: 4, areaMax: 2.0 },
  { espesor: 5, areaMax: 3.0 },
  { espesor: 6, areaMax: 4.0 },
  { espesor: 8, areaMax: 6.0 },
  { espesor: 10, areaMax: 8.0 },
  { espesor: 12, areaMax: 10.0 },
];

export const AREA_MAX_LAMINADO = [
  { espesor: 5, areaMax: 2.0 },
  { espesor: 6, areaMax: 3.0 },
  { espesor: 8, areaMax: 5.0 },
  { espesor: 10, areaMax: 7.0 },
  { espesor: 12, areaMax: 9.0 },
];

// ---------------------------------------------------------------------------
// PRESIÓN DE VIENTO kN/m² (kPa) DEL PROYECTO
// Filas: altura de instalación (m). Columnas: región/ciudad.
// Presión mínima 0.40 kPa. Datos para vidrios verticales, Factor de importancia II,
// categoría de exposición C, edificio cerrado, sin efectos topográficos, Zona 5 del edificio.
// ---------------------------------------------------------------------------
export const REGIONES = [
  { id: "Region 1 - Bucaramanga", ciudad: "Bucaramanga" },
  { id: "Region 2 - Bogota", ciudad: "Bogotá" },
  { id: "Region 3 - Cali", ciudad: "Cali" },
  { id: "Region 4 - Medellin", ciudad: "Medellín" },
  { id: "Region 5 - Barranquilla", ciudad: "Barranquilla" },
];

// [altura(m), R1 Bucaramanga, R2 Bogota, R3 Cali, R4 Medellin, R5 Barranquilla]
// (el valor de Bogotá a 70 m aparecía como 0.85 en la fuente escaneada; es un error de
//  digitalización — se corrige por interpolación monótona a 0.49.)
export const PRESION_VIENTO = [
  [5, 0.4, 0.4, 0.51, 0.72, 0.85],
  [10, 0.4, 0.4, 0.54, 0.76, 0.9],
  [20, 0.4, 0.4, 0.61, 0.85, 1.01],
  [30, 0.4, 0.4, 0.66, 0.91, 1.09],
  [40, 0.4, 0.44, 0.71, 0.99, 1.18],
  [50, 0.4, 0.45, 0.73, 1.01, 1.21],
  [60, 0.4, 0.47, 0.76, 1.06, 1.26],
  [70, 0.4, 0.49, 0.78, 1.09, 1.3],
  [80, 0.4, 0.5, 0.81, 1.12, 1.34],
  [90, 0.4, 0.51, 0.83, 1.15, 1.37],
  [100, 0.4, 0.52, 0.85, 1.18, 1.4],
  [110, 0.4, 0.53, 0.86, 1.2, 1.43],
  [120, 0.4, 0.54, 0.88, 1.22, 1.46],
];

const REGION_COL = {
  "Region 1 - Bucaramanga": 1,
  "Region 2 - Bogota": 2,
  "Region 3 - Cali": 3,
  "Region 4 - Medellin": 4,
  "Region 5 - Barranquilla": 5,
};

export const PRESION_MINIMA = 0.4; // kPa

/**
 * Presión de viento (kPa) para una región y altura de instalación (m).
 * Interpola linealmente entre alturas tabuladas; extrapola planamente fuera del rango.
 */
export function presionViento(region, alturaM) {
  const col = REGION_COL[region];
  const filas = PRESION_VIENTO;
  if (alturaM <= filas[0][0]) return Math.max(filas[0][col], PRESION_MINIMA);
  const ultima = filas[filas.length - 1];
  if (alturaM >= ultima[0]) return Math.max(ultima[col], PRESION_MINIMA);
  for (let i = 0; i < filas.length - 1; i++) {
    const h0 = filas[i][0];
    const h1 = filas[i + 1][0];
    if (alturaM >= h0 && alturaM <= h1) {
      const p0 = filas[i][col];
      const p1 = filas[i + 1][col];
      const t = (alturaM - h0) / (h1 - h0);
      return Math.max(p0 + t * (p1 - p0), PRESION_MINIMA);
    }
  }
  return Math.max(ultima[col], PRESION_MINIMA);
}

// ---------------------------------------------------------------------------
// TABLA VIDRIO LAMINADO LG — Área máxima (m²) según presión de viento (kN/m²) y espesor (mm)
// null = no disponible / no aplica.
// ---------------------------------------------------------------------------
export const ESPESORES_LAMINADO_LG = [5, 6, 8, 10, 12, 16]; // mm

export const AREA_MAX_LAMINADO_LG = [
  { presion: 0.5, areas: [8.64, 11.56, null, null, null, null] },
  { presion: 0.75, areas: [5.45, 7.57, 12.33, null, null, null] },
  { presion: 1.0, areas: [3.84, 5.31, 8.08, 10.26, null, null] },
  { presion: 1.25, areas: [2.42, 3.92, 6.02, 7.76, 9.5, null] },
  { presion: 1.5, areas: [2.31, 3.13, 4.65, 6.06, 7.61, 13.36] },
  { presion: 2.0, areas: [1.57, 2.08, 3.25, 4.21, 5.38, 8.9] },
  { presion: 3.0, areas: [0.91, 1.28, 2.0, 2.65, 3.38, 5.71] },
  { presion: 4.0, areas: [0.63, 0.9, 1.3, 1.84, 2.41, 4.15] },
  { presion: 5.0, areas: [0.52, 0.64, 0.9, 1.41, 1.88, 3.23] },
  { presion: 7.0, areas: [0.32, 0.48, 0.71, 0.96, 1.27, 2.16] },
];

/** Fila de la tabla LG para la presión (toma la presión tabulada >= solicitada = lado seguro). */
function filaLGparaPresion(presion) {
  const tabla = AREA_MAX_LAMINADO_LG;
  for (const fila of tabla) {
    if (fila.presion >= presion - 1e-9) return fila;
  }
  return tabla[tabla.length - 1];
}

/** Composición típica del vidrio laminado según espesor total (mm). */
export function composicionLaminado(espesorMM) {
  const map = { 5: "2.5+2.5", 6: "3+3", 8: "4+4", 10: "5+5", 12: "6+6", 16: "8+8" };
  return map[espesorMM] ?? `${espesorMM} mm`;
}

// ---------------------------------------------------------------------------
// SELECCIÓN DEL ESPESOR MÍNIMO QUE CUMPLE
// ---------------------------------------------------------------------------

/**
 * Vidrio LAMINADO: usa la tabla VIDRIO LAMINADO LG (presión + área).
 * Escoge el menor espesor cuyo área máxima >= área de la hoja a esa presión.
 */
export function espesorLaminado(areaHoja, presion) {
  const fila = filaLGparaPresion(presion);
  for (let i = 0; i < ESPESORES_LAMINADO_LG.length; i++) {
    const areaMax = fila.areas[i];
    if (areaMax != null && areaHoja <= areaMax + 1e-9) {
      const esp = ESPESORES_LAMINADO_LG[i];
      return {
        espesorMM: esp,
        areaMaxTabla: areaMax,
        composicion: composicionLaminado(esp),
        cumple: true,
        fuente: "Tabla Vidrio Laminado LG (ASTM E-1300)",
        detalle: `Presión ${fila.presion} kPa · área hoja ${areaHoja.toFixed(2)} m² ≤ ${areaMax} m²`,
      };
    }
  }
  const idx = ESPESORES_LAMINADO_LG.length - 1;
  const areaMax = fila.areas[idx];
  return {
    espesorMM: ESPESORES_LAMINADO_LG[idx],
    areaMaxTabla: areaMax,
    composicion: composicionLaminado(ESPESORES_LAMINADO_LG[idx]),
    cumple: false,
    fuente: "Tabla Vidrio Laminado LG (ASTM E-1300)",
    detalle: `Ningún espesor cumple a ${fila.presion} kPa para ${areaHoja.toFixed(2)} m². Reducir hoja o subdividir en más naves.`,
  };
}

/** Vidrio MONOLÍTICO (templado de seguridad): usa Tabla K.4.3-1. */
export function espesorMonolitico(areaHoja) {
  for (const fila of AREA_MAX_TEMPLADO) {
    if (areaHoja <= fila.areaMax + 1e-9) {
      return {
        espesorMM: fila.espesor,
        areaMaxTabla: fila.areaMax,
        composicion: "monolítico templado",
        cumple: true,
        fuente: "Tabla K.4.3-1 NSR-10 (templado de seguridad)",
        detalle: `Área hoja ${areaHoja.toFixed(2)} m² ≤ ${fila.areaMax} m²`,
      };
    }
  }
  const ultima = AREA_MAX_TEMPLADO[AREA_MAX_TEMPLADO.length - 1];
  return {
    espesorMM: ultima.espesor,
    areaMaxTabla: ultima.areaMax,
    composicion: "monolítico templado",
    cumple: false,
    fuente: "Tabla K.4.3-1 NSR-10 (templado de seguridad)",
    detalle: `Ningún espesor cumple para ${areaHoja.toFixed(2)} m² (máx ${ultima.areaMax} m²). Subdividir en más naves.`,
  };
}
