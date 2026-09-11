/**
 * Visor 3D de IFC basado en web-ifc + three.js.
 * - Carga un archivo IFC (Uint8Array) por lotes (la interfaz no se congela y muestra progreso).
 * - Fusiona toda la geometría de cada elemento en 1–2 mallas (opaca / transparente) con
 *   colores por vértice: muchísimas menos draw calls y materiales que una malla por pieza.
 * - Renderiza solo cuando algo cambia (cámara, selección, carga), no 60 veces por segundo.
 * - Selección por click (resaltado) y multiselección con Ctrl/Shift.
 * - Captura de vistas por lotes para el informe (tamaño y modo fantasma configurados una sola vez).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as WebIFC from "web-ifc";
import { construirEjes } from "./ifc-grids.js";

const yieldUI = () => new Promise((r) => setTimeout(r, 0));

export class IfcViewer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.ifcAPI = new WebIFC.IfcAPI();
    this.modelID = -1;
    this.root = new THREE.Group();
    this.overlay = new THREE.Group();
    this.elementos = new Map(); // expressID -> { expressID, meshes[], bbox }
    this.allMeshes = [];
    this.selected = new Set();
    this.listeners = [];
    this.needsRender = true;

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 5000);
    this.camera.position.set(20, 20, 20);

    // Sin preserveDrawingBuffer: la captura se hace en el mismo tick que el render.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1a1d21);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener("change", () => (this.needsRender = true));

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(30, 50, 20);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dir2.position.set(-30, 20, -20);
    this.scene.add(dir2);

    this.scene.add(new THREE.GridHelper(100, 50, 0x444444, 0x2a2d31));

    // Materiales compartidos por TODO el modelo (el color va por vértice).
    this.matOpaco = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      metalness: 0.05,
      roughness: 0.75,
    });
    this.matTransp = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      metalness: 0.05,
      roughness: 0.75,
    });
    this.highlightMat = new THREE.MeshStandardMaterial({
      color: 0xff6a00,
      emissive: 0x552200,
      metalness: 0.1,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });

    // web-ifc entrega la geometría ya en Y-up (convención three.js): no se rota.
    this.scene.add(this.root);
    this.scene.add(this.overlay);
    this.grids = new THREE.Group();
    this.scene.add(this.grids);

    window.addEventListener("resize", () => this.onResize());
    this.renderer.domElement.addEventListener("click", (e) => this.onClick(e));

    this.animate = this.animate.bind(this);
    this.animate();
  }

  onSelectionChange(fn) {
    this.listeners.push(fn);
  }

  invalidate() {
    this.needsRender = true;
  }

  async init(wasmPath) {
    this.ifcAPI.SetWasmPath(wasmPath, true);
    await this.ifcAPI.Init();
  }

  /**
   * Carga el IFC. onProgress(fase, hecho, total) permite mostrar avance.
   */
  async loadIFC(data, onProgress = () => {}) {
    this.clear();
    onProgress("parse", 0, 1);
    await yieldUI();
    this.modelID = this.ifcAPI.OpenModel(data, { COORDINATE_TO_ORIGIN: true });

    // 1) Teselación (web-ifc, síncrona). Los vértices se copian aquí mismo porque web-ifc
    //    libera la geometría de cada malla al terminar su callback.
    onProgress("tessellate", 0, 1);
    await yieldUI();
    const pendientes = [];
    const api = this.ifcAPI;
    const modelID = this.modelID;
    api.StreamAllMeshes(modelID, (flatMesh) => {
      const geometries = flatMesh.geometries;
      const n = geometries.size();
      const partes = [];
      for (let i = 0; i < n; i++) {
        const placed = geometries.get(i);
        const geom = api.GetGeometry(modelID, placed.geometryExpressID);
        const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const indices = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
        geom.delete();
        if (verts.length && indices.length)
          partes.push({ verts, indices, m: placed.flatTransformation, color: placed.color });
      }
      if (partes.length) pendientes.push({ expressID: flatMesh.expressID, partes });
    });

    // 2) Construcción de mallas three.js por lotes, cediendo el hilo para pintar progreso.
    const total = pendientes.length;
    const LOTE = 150;
    for (let k = 0; k < total; k += LOTE) {
      const fin = Math.min(k + LOTE, total);
      for (let j = k; j < fin; j++) {
        this.construirElemento(pendientes[j]);
        pendientes[j] = null; // liberar las copias de vértices cuanto antes
      }
      onProgress("build", fin, total);
      this.needsRender = true;
      await yieldUI();
    }

    // 3) Ejes / grillas del IFC
    try {
      const ejes = construirEjes(this.ifcAPI, this.modelID);
      if (ejes) this.addGrid(ejes);
      this.numEjes = ejes ? ejes.userData.count || 0 : 0;
    } catch (e) {
      console.warn("No se pudieron cargar los ejes:", e);
      this.numEjes = 0;
    }

    this.fitToModel();
    onProgress("done", total, total);
    return this.modelID;
  }

  /** Fusiona todas las piezas de un elemento en 1 malla opaca y/o 1 transparente. */
  construirElemento({ expressID, partes }) {
    const grupos = { op: [], tr: [] };
    const bbox = new THREE.Box3();

    for (const parte of partes) (parte.color.w < 1 ? grupos.tr : grupos.op).push(parte);

    const meshes = [];
    for (const [key, lista] of Object.entries(grupos)) {
      if (!lista.length) continue;
      const g = this.fusionar(lista, bbox);
      const mesh = new THREE.Mesh(g, key === "tr" ? this.matTransp : this.matOpaco);
      mesh.userData.expressID = expressID;
      mesh.userData.baseMat = mesh.material;
      mesh.matrixAutoUpdate = false;
      meshes.push(mesh);
      this.root.add(mesh);
      this.allMeshes.push(mesh);
    }
    if (meshes.length) this.elementos.set(expressID, { expressID, meshes, bbox });
  }

  /**
   * Une varias piezas (6 floats/vértice: px,py,pz,nx,ny,nz) aplicando su matriz en CPU y
   * escribiendo color RGBA por vértice. Amplía bbox con los vértices transformados.
   */
  fusionar(lista, bbox) {
    let nV = 0;
    let nI = 0;
    for (const p of lista) {
      nV += p.verts.length / 6;
      nI += p.indices.length;
    }
    const pos = new Float32Array(nV * 3);
    const nor = new Float32Array(nV * 3);
    const col = new Float32Array(nV * 4);
    const idx = nV > 65535 ? new Uint32Array(nI) : new Uint16Array(nI);

    let vo = 0; // offset de vértice
    let io = 0; // offset de índice
    const nm = new THREE.Matrix3();
    const m4 = new THREE.Matrix4();
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const p of lista) {
      const e = p.m;
      m4.fromArray(e);
      nm.getNormalMatrix(m4);
      const n = nm.elements;
      const { verts, indices } = p;
      const cnt = verts.length / 6;
      const r = p.color.x, gc = p.color.y, b = p.color.z, a = p.color.w;

      for (let i = 0; i < cnt; i++) {
        const s = i * 6;
        const x = verts[s], y = verts[s + 1], z = verts[s + 2];
        const px = e[0] * x + e[4] * y + e[8] * z + e[12];
        const py = e[1] * x + e[5] * y + e[9] * z + e[13];
        const pz = e[2] * x + e[6] * y + e[10] * z + e[14];
        const d = (vo + i) * 3;
        pos[d] = px; pos[d + 1] = py; pos[d + 2] = pz;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (pz < minZ) minZ = pz;
        if (pz > maxZ) maxZ = pz;

        const nx = verts[s + 3], ny = verts[s + 4], nz = verts[s + 5];
        const ox = n[0] * nx + n[3] * ny + n[6] * nz;
        const oy = n[1] * nx + n[4] * ny + n[7] * nz;
        const oz = n[2] * nx + n[5] * ny + n[8] * nz;
        const len = Math.hypot(ox, oy, oz) || 1;
        nor[d] = ox / len; nor[d + 1] = oy / len; nor[d + 2] = oz / len;

        const c = (vo + i) * 4;
        col[c] = r; col[c + 1] = gc; col[c + 2] = b; col[c + 3] = a;
      }
      for (let i = 0; i < indices.length; i++) idx[io + i] = indices[i] + vo;
      vo += cnt;
      io += indices.length;
    }

    if (nV > 0) {
      bbox.min.set(Math.min(bbox.min.x, minX), Math.min(bbox.min.y, minY), Math.min(bbox.min.z, minZ));
      bbox.max.set(Math.max(bbox.max.x, maxX), Math.max(bbox.max.y, maxY), Math.max(bbox.max.z, maxZ));
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ)
    );
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }

  onClick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.allMeshes, false);

    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (hits.length === 0) {
      if (!additive) this.clearSelection();
      return;
    }
    const id = hits[0].object.userData.expressID;
    if (!additive) this.clearSelection(false);
    this.toggle(id);
    this.emit();
  }

  toggle(expressID) {
    if (this.selected.has(expressID)) this.deselect(expressID);
    else this.select(expressID);
  }

  select(expressID) {
    const el = this.elementos.get(expressID);
    if (!el || this.selected.has(expressID)) return;
    this.selected.add(expressID);
    for (const m of el.meshes) m.material = this.highlightMat;
    this.needsRender = true;
  }

  deselect(expressID) {
    const el = this.elementos.get(expressID);
    if (!el) return;
    this.selected.delete(expressID);
    for (const m of el.meshes) m.material = m.userData.baseMat;
    this.needsRender = true;
  }

  clearSelection(emit = true) {
    for (const id of Array.from(this.selected)) this.deselect(id);
    this.selected.clear();
    if (emit) this.emit();
  }

  selectMany(ids) {
    this.clearSelection(false);
    for (const id of ids) this.select(id);
    this.emit();
  }

  emit() {
    const ids = Array.from(this.selected);
    for (const fn of this.listeners) fn(ids);
  }

  isolate(ids) {
    const set = ids ? new Set(ids) : null;
    for (const [id, el] of this.elementos) {
      const visible = set ? set.has(id) : true;
      for (const m of el.meshes) m.visible = visible;
    }
    this.needsRender = true;
  }

  addOverlay(obj) {
    this.overlay.add(obj);
    this.needsRender = true;
  }
  clearOverlay() {
    this.overlay.clear();
    this.needsRender = true;
  }

  addGrid(obj) {
    this.grids.add(obj);
    this.needsRender = true;
  }
  clearGrids() {
    this.grids.clear();
    this.needsRender = true;
  }
  setGridsVisible(v) {
    this.grids.visible = v;
    this.needsRender = true;
  }

  // --- Encuadre de cámara ---------------------------------------------------
  /** Caja envolvente (mundo) de un conjunto de elementos por expressID. */
  boxOf(ids) {
    const box = new THREE.Box3();
    for (const id of ids) {
      const el = this.elementos.get(id);
      if (el && !el.bbox.isEmpty()) box.union(el.bbox);
    }
    return box;
  }

  /** Caja del modelo completo (unión de bboxes precalculados: no recorre vértices). */
  boxModelo() {
    const box = new THREE.Box3();
    for (const [, el] of this.elementos) if (!el.bbox.isEmpty()) box.union(el.bbox);
    return box;
  }

  /** Encuadra la cámara sobre una caja, desde 'iso' o 'top' (planta). */
  frameBox(box, vista = "iso", pad = 1.4) {
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.5);
    const dist = maxDim * pad + maxDim;
    this.controls.target.copy(center);
    if (vista === "top") {
      this.camera.position.set(center.x, center.y + dist * 1.4, center.z + 0.0001);
      this.camera.up.set(0, 0, -1);
    } else {
      this.camera.position.set(center.x + dist, center.y + dist * 0.8, center.z + dist);
      this.camera.up.set(0, 1, 0);
    }
    this.camera.near = Math.max(maxDim / 1000, 0.01);
    this.camera.far = maxDim * 100 + 1000;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.needsRender = true;
  }

  frameObjects(ids, vista = "iso", pad = 1.4) {
    this.frameBox(this.boxOf(ids), vista, pad);
  }

  // --- Captura de imagen ----------------------------------------------------
  /**
   * Captura una serie de vistas en un solo lote (para el informe).
   * grupos: [{ ids: number[]|null, ghost: bool, vista: 'iso'|'top', pad }]
   * Devuelve un array de dataURL (mismo orden). Es asíncrona y llama onProgress(i, n).
   */
  async captureLote(
    grupos,
    { width = 1000, height = 650, format = "image/jpeg", quality = 0.82, onProgress = () => {} } = {}
  ) {
    const canvas = this.renderer.domElement;
    const prev = {
      w: canvas.clientWidth,
      h: canvas.clientHeight,
      pr: this.renderer.getPixelRatio(),
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
      up: this.camera.up.clone(),
      aspect: this.camera.aspect,
      vis: this.allMeshes.map((m) => m.visible),
    };

    // Suspende el bucle de animación: si no, cada cesión del hilo redibuja toda la escena.
    this.capturing = true;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;

    const ghost = this.ghostMat();
    const setAll = (visible, mat) => {
      for (const m of this.allMeshes) {
        m.visible = visible;
        m.material = mat ? mat : m.userData.baseMat;
      }
    };

    /**
     * Modo fantasma acotado: solo se dibujan (en fantasma) los elementos cuya caja toca la
     * vecindad de los objetivos. En una vista cercana a una ventana eso descarta casi todo
     * el edificio, que de otro modo se renderizaría entero detrás del vidrio en cada tipo.
     */
    const _exp = new THREE.Box3();
    const _size = new THREE.Vector3();
    const setGhostVecindad = (ids, box, vecindad) => {
      const objetivo = new Set(ids);
      let exp = null;
      if (vecindad != null && !box.isEmpty()) {
        box.getSize(_size);
        const margen = Math.max(_size.x, _size.y, _size.z, 1) * vecindad + 1.5;
        exp = _exp.copy(box).expandByScalar(margen);
      }
      for (const [id, el] of this.elementos) {
        const esObjetivo = objetivo.has(id);
        const visible = esObjetivo || !exp || el.bbox.intersectsBox(exp);
        const mat = esObjetivo ? null : ghost;
        for (const m of el.meshes) {
          m.visible = visible;
          m.material = mat ? mat : m.userData.baseMat;
        }
      }
    };

    // OJO: cuando la pestaña está oculta (p. ej. se abrió la ventana del informe encima),
    // Chrome limita setTimeout y los callbacks de toBlob a UNO POR SEGUNDO. En ese caso
    // no se cede el hilo ni se usa toBlob: todo síncrono, que en segundo plano corre a
    // velocidad normal.
    const visible = () => document.visibilityState === "visible";

    // Codificación asíncrona (toBlob encola el JPEG fuera del hilo principal en Chrome)
    const codificar = () =>
      new Promise((resolve) => {
        if (!canvas.toBlob || !visible()) return resolve(canvas.toDataURL(format, quality));
        canvas.toBlob(
          (blob) => {
            if (!blob) return resolve(canvas.toDataURL(format, quality));
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => resolve(canvas.toDataURL(format, quality));
            fr.readAsDataURL(blob);
          },
          format,
          quality
        );
      });

    const salida = [];
    let ultimoYield = performance.now();
    try {
      for (let i = 0; i < grupos.length; i++) {
        const g = grupos[i];
        const vista = g.vista ?? "iso";
        const pad = g.pad ?? 1.4;
        if (!g.ids) {
          setAll(true, null);
          this.frameBox(this.boxModelo(), vista, pad);
        } else {
          const box = this.boxOf(g.ids);
          if (g.ghost) setGhostVecindad(g.ids, box, g.vecindad);
          else this.isolate(g.ids);
          this.frameBox(box, vista, pad);
        }
        this.camera.updateProjectionMatrix();
        this.renderer.render(this.scene, this.camera);
        salida.push(codificar());
        onProgress(i + 1, grupos.length);
        // ceder el hilo solo de vez en cuando (cada cesión cuesta ~1 frame) y solo si la
        // pestaña está visible (oculta, cada setTimeout esperaría 1 s)
        if (visible() && performance.now() - ultimoYield > 80) {
          await yieldUI();
          ultimoYield = performance.now();
        }
      }
      return await Promise.all(salida);
    } finally {
      // restaurar materiales (respetando selección), visibilidad, cámara y tamaño
      for (const m of this.allMeshes) {
        m.material = this.selected.has(m.userData.expressID) ? this.highlightMat : m.userData.baseMat;
      }
      this.allMeshes.forEach((m, i) => (m.visible = prev.vis[i] ?? true));
      this.camera.position.copy(prev.pos);
      this.controls.target.copy(prev.target);
      this.camera.up.copy(prev.up);
      this.camera.aspect = prev.aspect;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(prev.pr);
      this.renderer.setSize(prev.w, prev.h, false);
      this.controls.update();
      this.capturing = false;
      this.needsRender = true;
    }
  }

  /** Compatibilidad: una sola vista (usa captureLote). */
  async captureVista(ids, vista = "iso", { width = 1000, height = 650, pad = 1.4, ghost = false } = {}) {
    const [url] = await this.captureLote([{ ids, vista, pad, ghost }], { width, height });
    return url;
  }

  ghostMat() {
    // Sin iluminación: el fantasma es un velo al 12 %, no necesita PBR.
    if (!this._ghostMat)
      this._ghostMat = new THREE.MeshBasicMaterial({
        color: 0x8a939c,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    return this._ghostMat;
  }

  clear() {
    for (const m of this.allMeshes) {
      m.geometry.dispose();
      this.root.remove(m);
    }
    this.allMeshes = [];
    this.elementos.clear();
    this.selected.clear();
    this.clearOverlay();
    this.clearGrids();
    if (this.modelID >= 0) {
      try {
        this.ifcAPI.CloseModel(this.modelID);
      } catch (e) {
        /* noop */
      }
      this.modelID = -1;
    }
    this.needsRender = true;
  }

  fitToModel() {
    const box = this.boxModelo();
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 1.6;
    this.controls.target.copy(center);
    this.camera.position.set(center.x + dist, center.y + dist * 0.8, center.z + dist);
    this.camera.near = Math.max(maxDim / 1000, 0.01);
    this.camera.far = maxDim * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.needsRender = true;
  }

  onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.needsRender = true;
  }

  animate() {
    requestAnimationFrame(this.animate);
    if (this.capturing) return; // durante la captura del informe no se redibuja la vista
    const moved = this.controls.update();
    if (moved || this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    }
  }
}
