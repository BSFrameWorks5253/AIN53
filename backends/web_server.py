"""
AIN53 Data Management - Embedded Web Server
============================================

Provides dual-mode web access (local HTTP server + JSON-RPC API bridge)
allowing the full AIN53 application to run inside standard web browsers
(Chrome, Edge, Firefox, Safari) or across the local network while maintaining
100% feature parity with the PyWebView desktop app container.
"""

import os
import sys
import json
import socket
import mimetypes
import threading
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"


class AIN53RequestHandler(SimpleHTTPRequestHandler):
    """
    HTTP Request Handler that serves frontend assets and dispatches
    POST /api/<method> calls directly to UnifiedApi instances.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

    def log_message(self, format, *args):
        # Quiet standard logging to keep terminal output clean
        pass

    def end_headers(self):
        # Enable CORS for local cross-origin development flexibility
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        clean_path = parsed.path

        # Health & Status endpoint
        if clean_path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            status_data = {
                "status": "running",
                "app": "AIN53 Data Management",
                "mode": "web-server"
            }
            self.wfile.write(json.dumps(status_data).encode("utf-8"))
            return

        # Direct PDF Preview stream endpoint
        if clean_path == "/api/pdf_preview":
            api_instance = getattr(self.server, "api", None)
            pdf_path = None
            if api_instance and hasattr(api_instance, "_pdf"):
                pdf_path = getattr(api_instance._pdf, "_pdf_source_path", None)
            if not pdf_path or not os.path.isfile(pdf_path):
                try:
                    from backends.updater import AutoUpdater
                    updater = AutoUpdater()
                    pdf_path = updater._load_settings().get("pdf_source_path")
                except Exception:
                    pass

            if pdf_path and os.path.isfile(pdf_path):
                try:
                    import shutil
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Disposition", f'inline; filename="{os.path.basename(pdf_path)}"')
                    self.send_header("Content-Length", str(os.path.getsize(pdf_path)))
                    self.end_headers()
                    with open(pdf_path, "rb") as f:
                        shutil.copyfileobj(f, self.wfile)
                    return
                except Exception as e:
                    self.send_response(500)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
                    return
            else:
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error": "No PDF file currently loaded"}')
                return

        # Default route to index.html
        if clean_path in ("", "/"):
            self.path = "/index.html"

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        clean_path = parsed.path

        if clean_path.startswith("/api/"):
            method_name = clean_path[5:].strip("/")
            content_length = int(self.headers.get("Content-Length", 0))
            post_body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"

            try:
                payload = json.loads(post_body) if post_body.strip() else {}
                args = payload.get("args", [])
                if not isinstance(args, list):
                    args = [args]
            except Exception:
                args = []

            api_instance = getattr(self.server, "api", None)
            if not api_instance:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Backend API instance not bound"}).encode("utf-8"))
                return

            method = getattr(api_instance, method_name, None)
            if not method or not callable(method):
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"API method '{method_name}' not found"}).encode("utf-8"))
                return

            try:
                # Invoke backend Python RPC method
                result = method(*args)
                if not isinstance(result, str):
                    result_str = json.dumps(result)
                else:
                    result_str = result

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(result_str.encode("utf-8"))
            except Exception as ex:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(ex)}).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()


import socketserver


class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    """Custom Threaded HTTP Server holding a reference to UnifiedApi."""
    daemon_threads = True

    def __init__(self, server_address, RequestHandlerClass, api_instance):
        super().__init__(server_address, RequestHandlerClass)
        self.api = api_instance


def find_free_port(start_port=5353, max_attempts=50):
    """Finds an available TCP port starting from `start_port`."""
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start_port


def start_web_server(api_instance, host="0.0.0.0", port=5353, background=True):
    """
    Initializes and starts the embedded HTTP server on all interfaces (0.0.0.0).
    Returns (server_instance, url).
    """
    actual_port = find_free_port(port)
    server = ThreadedHTTPServer((host, actual_port), AIN53RequestHandler, api_instance)
    server_url = f"http://127.0.0.1:{actual_port}"

    if background:
        thread = threading.Thread(target=server.serve_forever, daemon=True, name="ain53-web-server")
        thread.start()
        print(f"[Web Server] Desktop Localhost URL: {server_url}")
        return server, server_url
    else:
        print(f"[Web Server] Desktop Localhost URL: {server_url}")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            server.shutdown()
        return server, server_url
