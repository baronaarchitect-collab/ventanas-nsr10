#!/usr/bin/env python3
"""
Servidor estático mínimo para la app (ES modules necesitan http, no file://).
Fuerza los MIME correctos para .js y .wasm (en Windows a veces el registro
devuelve text/plain y rompe la carga de módulos ES).

Uso:   python serve.py          -> abre http://localhost:5174
"""
import http.server
import socketserver
import webbrowser
import os

# Servir siempre la carpeta de este script, sin importar desde dónde se lance.
os.chdir(os.path.dirname(os.path.abspath(__file__)))

PORT = 5174

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".wasm": "application/wasm",
        ".ifc": "application/octet-stream",
        "": "application/octet-stream",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    with Server(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}/"
        print(f"Servidor en {url}  (Ctrl+C para detener)")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        httpd.serve_forever()
