# Ventanería NSR-10 — Detector de ventanas en IFC + verificación de vidrio

App externa (navegador) que **carga un modelo IFC**, **detecta las ventanas** y verifica el
**espesor de vidrio** según la **NSR-10, Título K.4** (vidrio y ventanería), a partir del área
de la hoja, la presión de viento (por ciudad y altura) y el tipo de vidrio.

## Versión en línea

**https://baronaarchitect-collab.github.io/ventanas-nsr10/** (GitHub Pages; se redespliega solo con cada `push` a `main`).

## Cómo ejecutar en local

No requiere instalar dependencias (three.js y web-ifc se cargan desde CDN). Solo necesita
un servidor local porque los módulos ES no funcionan con `file://`.

**Opción A — doble clic:** ejecute `iniciar.bat` (abre el navegador automáticamente).

**Opción B — manual:**
```
python serve.py
```
y abra `http://localhost:5174`.

> Requiere conexión a internet la primera vez (para descargar three.js y web-ifc del CDN).

> Se incluye `ejemplo.ifc` (con dos ventanas) para probar la app.

## Uso

1. **Cargar modelo IFC** (botón o arrastrar el `.ifc` al visor 3D; puede usar `ejemplo.ifc`).
2. Ajustar **parámetros del proyecto**:
   - **Altura de instalación** (m) del edificio/ventana.
   - **Ciudad / Región** (Bucaramanga, Bogotá, Cali, Medellín, Barranquilla).
   - **Tipo de vidrio**: *laminado* (tabla LG / ASTM E-1300) o *monolítico* (templado, Tabla K.4.3-1).
   - **Factor de vidrio**: % del vano que es vidrio (descuenta la perfilería).
   - **Ancho máx. de nave**: por defecto **1.5 m** (si la ventana es más ancha se subdivide en naves iguales).
3. **Detectar y calcular** → tabla de resultados por tipo (naves, área de hoja, espesor recomendado, estado).
4. Click en una fila → resalta esas ventanas en el 3D.
5. Exportar **Informe (PDF)** o **CSV**.

### Interfaz

- El **panel lateral se ensancha** arrastrando el borde que lo separa del visor (doble clic: restablecer).
- El **divisor sobre "Resultados por tipo"** reparte la altura entre parámetros y resultados; el título
  *Parámetros del proyecto* se pliega con un clic. Ancho y estado se recuerdan en el navegador.

### Informe

- Encabezado y cabecera de la tabla **fijos** al hacer scroll; botón *Imprimir / PDF*.
- Clic en cualquier imagen 3D para **ampliarla** (Esc o clic fuera para cerrar).
- Botón **🎯 Ver en modelo** por fila (y *Ver todas*): resalta y encuadra esas ventanas en el visor
  de la app (el informe se comunica con la app mediante `postMessage`; requiere que se haya abierto
  desde ella, no como archivo suelto).

## Rendimiento

- La geometría de cada elemento IFC se **fusiona en 1–2 mallas** con color por vértice y materiales
  compartidos (en lugar de una malla y un material por pieza): muchísimos menos *draw calls*.
- El visor **solo renderiza cuando algo cambia** (cámara, selección, carga), no 60 veces por segundo.
- La construcción del modelo se hace **por lotes** con indicador de progreso para no congelar la interfaz.
- Las vistas del informe se capturan **en lote**, en JPEG y a pixel ratio 1 (antes PNG a 2×).
- Librerías desde **jsdelivr** con `modulepreload` y precarga del `.wasm` de web-ifc.

## Lógica de cálculo (NSR-10 K.4)

1. La **presión de viento** se interpola por altura de instalación y ciudad
   (Factor de importancia II, exposición C, presión mínima 0.40 kPa).
2. Si el ancho de la ventana supera el **ancho máx. de nave (1.5 m)**, se subdivide en
   `ceil(ancho / 1.5)` naves iguales; el cálculo se hace por **área de hoja (nave)**.
3. **Laminado**: se busca el menor espesor cuya área máxima admisible (tabla *Vidrio Laminado LG*)
   sea ≥ el área de la hoja, a la presión de viento del proyecto.
4. **Monolítico/templado**: se usa la **Tabla K.4.3-1** (área máxima por espesor).
5. Si ningún espesor tabulado cumple → estado **REVISAR** (reducir tamaño o subdividir en más naves).

## Tablas incluidas (`src/nsr10.js`)

- **K.4.3-1** — áreas máximas de vidrio de seguridad (templado y laminado).
- **Presión de viento** por altura (5–120 m) y ciudad.
- **Vidrio Laminado LG** — área máxima (m²) por presión (0.5–7.0 kPa) y espesor (5–16 mm).

## Estructura

```
index.html          import-map (three + web-ifc por CDN) + interfaz
serve.py            servidor estático local (MIME correctos para .js/.wasm); --no-open no abre navegador
iniciar.bat         lanzador
src/
  viewer.js         visor 3D (web-ifc + three.js), selección multiselección
  ifc-windows.js    detección de IfcWindow + tipo + dimensiones + unidades
  nsr10.js          tablas y funciones de la NSR-10 K.4
  calculo.js        motor de cálculo (naves, área de hoja, espesor)
  report.js         informe HTML/PDF + CSV
  main.js           interfaz y orquestación
```
