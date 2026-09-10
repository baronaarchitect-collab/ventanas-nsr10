/**
 * Importa los EJES / GRILLAS del IFC (IfcGrid + IfcGridAxis) y los dibuja como
 * líneas con etiquetas (burbujas) en las coordenadas del modelo (metros, Z arriba).
 */
import * as THREE from "three";
import * as WebIFC from "web-ifc";

const num = (c) => (typeof c === "number" ? c : c?.value ?? 0);

function escalaLongitud(api, modelID) {
  try {
    const ids = api.GetLineIDsWithType(modelID, WebIFC.IFCSIUNIT);
    for (let i = 0; i < ids.size(); i++) {
      const u = api.GetLine(modelID, ids.get(i));
      if (u.UnitType?.value === "LENGTHUNIT" && u.Name?.value === "METRE") {
        const p = u.Prefix?.value;
        return { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 }[p] ?? 1;
      }
    }
  } catch (e) {}
  return 1;
}

function coordsDe(api, modelID, pointRef) {
  const p = api.GetLine(modelID, pointRef.value ?? pointRef);
  const c = p.Coordinates.map(num);
  return new THREE.Vector3(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);
}

function dirDe(api, modelID, ref, def) {
  if (!ref) return def.clone();
  const d = api.GetLine(modelID, ref.value);
  const r = d.DirectionRatios.map(num);
  return new THREE.Vector3(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0);
}

/** Matriz de un IfcAxis2Placement3D. */
function axis2placement(api, modelID, ref) {
  const p = api.GetLine(modelID, ref.value);
  const loc = coordsDe(api, modelID, p.Location);
  const z = dirDe(api, modelID, p.Axis, new THREE.Vector3(0, 0, 1));
  if (z.lengthSq() < 1e-9) z.set(0, 0, 1);
  z.normalize();
  let x = dirDe(api, modelID, p.RefDirection, new THREE.Vector3(1, 0, 0));
  x.addScaledVector(z, -x.dot(z)); // ortogonalizar
  if (x.lengthSq() < 1e-9) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(loc);
  return m;
}

/** Matriz acumulada de un IfcLocalPlacement (cadena PlacementRelTo). */
function placementMatrix(api, modelID, ref, cache) {
  if (!ref) return new THREE.Matrix4();
  const id = ref.value ?? ref;
  if (cache.has(id)) return cache.get(id);
  let m = new THREE.Matrix4();
  try {
    const pl = api.GetLine(modelID, id);
    let local = new THREE.Matrix4();
    if (pl.RelativePlacement) local = axis2placement(api, modelID, pl.RelativePlacement);
    if (pl.PlacementRelTo) {
      const parent = placementMatrix(api, modelID, pl.PlacementRelTo, cache);
      m = parent.clone().multiply(local);
    } else {
      m = local;
    }
  } catch (e) {}
  cache.set(id, m);
  return m;
}

/** Puntos (en coords locales del grid) de la curva de un eje. */
function puntosDeCurva(api, modelID, curveRef) {
  const curve = api.GetLine(modelID, curveRef.value);
  const pts = [];
  if (curve.type === WebIFC.IFCPOLYLINE) {
    for (const pr of curve.Points ?? []) pts.push(coordsDe(api, modelID, pr));
  } else if (curve.type === WebIFC.IFCLINE) {
    const p0 = coordsDe(api, modelID, curve.Pnt);
    const vec = api.GetLine(modelID, curve.Dir.value);
    const ori = api.GetLine(modelID, vec.Orientation.value);
    const r = ori.DirectionRatios.map(num);
    const dir = new THREE.Vector3(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0).normalize();
    const L = 50; // longitud del segmento a cada lado (unidades de archivo)
    pts.push(p0.clone().addScaledVector(dir, -L), p0.clone().addScaledVector(dir, L));
  }
  return pts;
}

function etiquetaSprite(texto) {
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d");
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
  ctx.fillStyle = "#1f2329";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#c9a227";
  ctx.stroke();
  ctx.fillStyle = "#f4e2a1";
  ctx.font = "bold 60px Segoe UI, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(texto).slice(0, 4), s / 2, s / 2 + 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  spr.scale.set(1.0, 1.0, 1.0); // ~1 m
  return spr;
}

/**
 * Construye un THREE.Group con todos los ejes del IFC (líneas + etiquetas).
 * Devuelve null si no hay grillas.
 */
export function construirEjes(api, modelID) {
  const escala = escalaLongitud(api, modelID);
  const cache = new Map();
  const grupo = new THREE.Group();
  const matLinea = new THREE.LineBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.75 });
  let count = 0;

  let gridIds;
  try {
    gridIds = api.GetLineIDsWithType(modelID, WebIFC.IFCGRID);
  } catch (e) {
    return null;
  }
  if (!gridIds || gridIds.size() === 0) return null;

  for (let g = 0; g < gridIds.size(); g++) {
    let grid;
    try {
      grid = api.GetLine(modelID, gridIds.get(g));
    } catch (e) {
      continue;
    }
    const M = placementMatrix(api, modelID, grid.ObjectPlacement, cache);
    const ejesRefs = [...(grid.UAxes ?? []), ...(grid.VAxes ?? []), ...(grid.WAxes ?? [])];

    for (const axRef of ejesRefs) {
      let ax;
      try {
        ax = api.GetLine(modelID, axRef.value);
      } catch (e) {
        continue;
      }
      const tag = ax.AxisTag?.value ?? "";
      const ptsLocal = puntosDeCurva(api, modelID, ax.AxisCurve);
      if (ptsLocal.length < 2) continue;

      // local -> coords de archivo (Z-up) -> metros -> Y-up (como la geometría de web-ifc)
      const pts = ptsLocal.map((p) => {
        const w = p.clone().applyMatrix4(M).multiplyScalar(escala); // Z-up
        return new THREE.Vector3(w.x, w.z, -w.y); // Z-up -> Y-up
      });

      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      grupo.add(new THREE.Line(geo, matLinea));

      // etiquetas en ambos extremos, desplazadas hacia afuera
      const a = pts[0];
      const b = pts[pts.length - 1];
      const dir = b.clone().sub(a).normalize();
      const off = 1.2;
      if (tag) {
        const l1 = etiquetaSprite(tag);
        l1.position.copy(a.clone().addScaledVector(dir, -off));
        grupo.add(l1);
        const l2 = etiquetaSprite(tag);
        l2.position.copy(b.clone().addScaledVector(dir, off));
        grupo.add(l2);
      }
      count++;
    }
  }

  grupo.userData.count = count;
  return count > 0 ? grupo : null;
}
