/**
 * Visor 3D de IFC basado en web-ifc + three.js.
 * - Carga un archivo IFC (Uint8Array).
 * - Genera la geometría y la agrupa por elemento (expressID).
 * - Permite selección por click (con resaltado) y multiselección con Ctrl/Shift.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as WebIFC from "web-ifc";
import { construirEjes } from "./ifc-grids.js";

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
    this.originalMats = new Map();
    this.listeners = [];

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 5000);
    this.camera.position.set(20, 20, 20);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1a1d21);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(30, 50, 20);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dir2.position.set(-30, 20, -20);
    this.scene.add(dir2);

    this.scene.add(new THREE.GridHelper(100, 50, 0x444444, 0x2a2d31));

    this.highlightMat = new THREE.MeshStandardMaterial({
      color: 0xff6a00,
      emissive: 0x552200,
      metalness: 0.1,
      roughness: 0.6,
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

  async init(wasmPath) {
    this.ifcAPI.SetWasmPath(wasmPath, true);
    await this.ifcAPI.Init();
  }

  async loadIFC(data) {
    this.clear();
    this.modelID = this.ifcAPI.OpenModel(data, { COORDINATE_TO_ORIGIN: true });

    const self = this;
    this.ifcAPI.StreamAllMeshes(this.modelID, (flatMesh) => {
      const expressID = flatMesh.expressID;
      const geometries = flatMesh.geometries;
      const meshesForElement = [];
      const bbox = new THREE.Box3();

      for (let i = 0; i < geometries.size(); i++) {
        const placed = geometries.get(i);
        const geom = self.ifcAPI.GetGeometry(self.modelID, placed.geometryExpressID);
        const verts = self.ifcAPI.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const indices = self.ifcAPI.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());

        const bufferGeom = self.buildGeometry(verts, indices);
        const matrix = new THREE.Matrix4();
        matrix.fromArray(placed.flatTransformation);

        const c = placed.color;
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(c.x, c.y, c.z),
          transparent: c.w < 1,
          opacity: c.w,
          side: THREE.DoubleSide,
          metalness: 0.05,
          roughness: 0.75,
        });

        const mesh = new THREE.Mesh(bufferGeom, material);
        mesh.applyMatrix4(matrix);
        mesh.userData.expressID = expressID;
        meshesForElement.push(mesh);
        self.root.add(mesh);
        self.allMeshes.push(mesh);

        bufferGeom.computeBoundingBox();
        bbox.union(bufferGeom.boundingBox.clone().applyMatrix4(matrix));

        geom.delete();
      }

      self.elementos.set(expressID, { expressID, meshes: meshesForElement, bbox });
    });

    // Ejes / grillas del IFC
    try {
      const ejes = construirEjes(this.ifcAPI, this.modelID);
      if (ejes) this.addGrid(ejes);
      this.numEjes = ejes ? ejes.userData.count || 0 : 0;
    } catch (e) {
      console.warn("No se pudieron cargar los ejes:", e);
      this.numEjes = 0;
    }

    this.fitToModel();
    return this.modelID;
  }

  buildGeometry(verts, indices) {
    // web-ifc entrega 6 floats por vértice: [px,py,pz, nx,ny,nz]
    const posCount = verts.length / 6;
    const positions = new Float32Array(posCount * 3);
    const normals = new Float32Array(posCount * 3);
    for (let i = 0; i < posCount; i++) {
      positions[i * 3] = verts[i * 6];
      positions[i * 3 + 1] = verts[i * 6 + 1];
      positions[i * 3 + 2] = verts[i * 6 + 2];
      normals[i * 3] = verts[i * 6 + 3];
      normals[i * 3 + 1] = verts[i * 6 + 4];
      normals[i * 3 + 2] = verts[i * 6 + 5];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
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
    for (const m of el.meshes) {
      if (!this.originalMats.has(m.id)) this.originalMats.set(m.id, m.material);
      m.material = this.highlightMat;
    }
  }

  deselect(expressID) {
    const el = this.elementos.get(expressID);
    if (!el) return;
    this.selected.delete(expressID);
    for (const m of el.meshes) {
      const orig = this.originalMats.get(m.id);
      if (orig) m.material = orig;
    }
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
  }

  addOverlay(obj) {
    this.overlay.add(obj);
  }
  clearOverlay() {
    this.overlay.clear();
  }

  addGrid(obj) {
    this.grids.add(obj);
  }
  clearGrids() {
    this.grids.clear();
  }
  setGridsVisible(v) {
    this.grids.visible = v;
  }

  // --- Encuadre de cámara ---------------------------------------------------
  /** Caja envolvente (mundo) de un conjunto de elementos por expressID. */
  boxOf(ids) {
    const box = new THREE.Box3();
    for (const id of ids) {
      const el = this.elementos.get(id);
      if (el && !el.bbox.isEmpty()) {
        // bbox está en espacio de modelo (Z-up); convertir al mundo aplicando la rotación del root
        const b = el.bbox.clone().applyMatrix4(this.root.matrixWorld);
        box.union(b);
      }
    }
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
  }

  frameObjects(ids, vista = "iso", pad = 1.4) {
    this.frameBox(this.boxOf(ids), vista, pad);
  }

  // --- Captura de imagen ----------------------------------------------------
  /** Renderiza y devuelve un dataURL PNG del estado actual. */
  captureImage(width = 1400, height = 900) {
    const oldW = this.renderer.domElement.width;
    const oldH = this.renderer.domElement.height;
    const oldAspect = this.camera.aspect;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.renderer.setSize(oldW, oldH, false);
    this.camera.aspect = oldAspect;
    this.camera.updateProjectionMatrix();
    return url;
  }

  /**
   * Aísla los ids indicados (o muestra todo si null), encuadra y captura.
   * Restaura visibilidad y cámara al terminar.
   */
  captureVista(ids, vista = "iso", { width = 1400, height = 900, pad = 1.4, ghost = false } = {}) {
    // guardar estado
    const prevVis = new Map();
    for (const [id, el] of this.elementos) prevVis.set(id, el.meshes.map((m) => m.visible));
    const prevPos = this.camera.position.clone();
    const prevTarget = this.controls.target.clone();
    const prevUp = this.camera.up.clone();
    const prevAspect = this.camera.aspect;

    if (ids) {
      const set = new Set(ids);
      for (const [id, el] of this.elementos) {
        const vis = set.has(id);
        for (const m of el.meshes) {
          if (ghost && !vis) {
            m.visible = true;
            m.userData._prevMat = m.material;
            m.material = this.ghostMat();
          } else {
            m.visible = vis;
          }
        }
      }
      this.frameObjects(ids, vista, pad);
    } else {
      for (const [, el] of this.elementos) for (const m of el.meshes) m.visible = true;
      this.frameBox(new THREE.Box3().setFromObject(this.root), vista, pad);
    }

    const url = this.captureImage(width, height);

    // restaurar
    for (const [id, el] of this.elementos) {
      const vis = prevVis.get(id);
      el.meshes.forEach((m, i) => {
        if (m.userData._prevMat) {
          m.material = m.userData._prevMat;
          delete m.userData._prevMat;
        }
        m.visible = vis ? vis[i] : true;
      });
    }
    this.camera.position.copy(prevPos);
    this.controls.target.copy(prevTarget);
    this.camera.up.copy(prevUp);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    return url;
  }

  ghostMat() {
    if (!this._ghostMat)
      this._ghostMat = new THREE.MeshStandardMaterial({
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
    this.originalMats.clear();
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
  }

  fitToModel() {
    const box = new THREE.Box3().setFromObject(this.root);
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
  }

  onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  animate() {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
