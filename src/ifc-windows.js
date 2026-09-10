/**
 * Detección de ventanas en el modelo IFC.
 * Extrae IfcWindow con su tipo (IfcWindowType), ancho y alto (OverallWidth/OverallHeight),
 * convirtiendo a metros según la unidad de longitud del proyecto.
 */
import * as WebIFC from "web-ifc";

/** Escala para convertir las longitudes del archivo a metros. */
export function escalaLongitud(api, modelID) {
  try {
    const ids = api.GetLineIDsWithType(modelID, WebIFC.IFCSIUNIT);
    for (let i = 0; i < ids.size(); i++) {
      const u = api.GetLine(modelID, ids.get(i));
      if (u.UnitType?.value === "LENGTHUNIT" && u.Name?.value === "METRE") {
        const prefix = u.Prefix?.value;
        const map = { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 };
        return prefix ? map[prefix] ?? 1 : 1;
      }
    }
    const conv = api.GetLineIDsWithType(modelID, WebIFC.IFCCONVERSIONBASEDUNIT);
    for (let i = 0; i < conv.size(); i++) {
      const u = api.GetLine(modelID, conv.get(i));
      const name = (u.Name?.value ?? "").toLowerCase();
      if (u.UnitType?.value === "LENGTHUNIT") {
        if (name.includes("inch")) return 0.0254;
        if (name.includes("foot") || name.includes("feet")) return 0.3048;
      }
    }
  } catch (e) {
    /* usar 1 por defecto */
  }
  return 1;
}

/** Mapa expressID(elemento) -> nombre de tipo, usando IfcRelDefinesByType. */
function mapaTipos(api, modelID) {
  const map = new Map();
  const nombres = new Map(); // id de tipo -> nombre (cada tipo se lee una sola vez)
  try {
    const rels = api.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYTYPE);
    for (let i = 0; i < rels.size(); i++) {
      const rel = api.GetLine(modelID, rels.get(i));
      if (!rel.RelatingType) continue;
      const tid = rel.RelatingType.value;
      let typeName = nombres.get(tid);
      if (typeName === undefined) {
        typeName = "Tipo";
        try {
          const t = api.GetLine(modelID, tid);
          typeName = t.Name?.value ?? t.ObjectType?.value ?? "Tipo";
        } catch (e) {
          /* noop */
        }
        nombres.set(tid, typeName);
      }
      const related = rel.RelatedObjects ?? [];
      for (const r of related) {
        if (r?.value != null) map.set(r.value, typeName);
      }
    }
  } catch (e) {
    /* noop */
  }
  return map;
}

/**
 * Devuelve todas las ventanas detectadas (en metros).
 * Usa OverallWidth/OverallHeight; si faltan, recurre al bounding box de la geometría.
 */
export function detectarVentanas(viewer) {
  const api = viewer.ifcAPI;
  const modelID = viewer.modelID;
  const escala = escalaLongitud(api, modelID);
  const tipos = mapaTipos(api, modelID);

  const ventanas = [];
  const ids = api.GetLineIDsWithType(modelID, WebIFC.IFCWINDOW);

  for (let i = 0; i < ids.size(); i++) {
    const id = ids.get(i);
    let line;
    try {
      line = api.GetLine(modelID, id);
    } catch (e) {
      continue;
    }

    const tipo = tipos.get(id) ?? line.ObjectType?.value ?? line.Name?.value ?? "Ventana";

    let ancho = line.OverallWidth?.value;
    let alto = line.OverallHeight?.value;
    if (ancho != null) ancho *= escala;
    if (alto != null) alto *= escala;

    if (ancho == null || alto == null || ancho <= 0 || alto <= 0) {
      const el = viewer.elementos.get(id);
      if (el && !el.bbox.isEmpty()) {
        const dims = [
          Math.abs(el.bbox.max.x - el.bbox.min.x),
          Math.abs(el.bbox.max.y - el.bbox.min.y),
          Math.abs(el.bbox.max.z - el.bbox.min.z),
        ].sort((a, b) => b - a);
        ancho = ancho ?? dims[0];
        alto = alto ?? dims[1];
      }
    }

    if (!ancho || !alto) continue;

    ventanas.push({
      expressID: id,
      tipo: String(tipo),
      ancho: Number(ancho),
      alto: Number(alto),
    });
  }

  return ventanas;
}
