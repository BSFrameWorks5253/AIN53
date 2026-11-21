"""
AIN53 Media Streaming Server (High-Performance 206 Partial Content Streamer)
Provides ultra-low latency, zero-buffering streaming and byte-range seeking for
4K, 8K, 10-bit H.264/H.265, MOV, MP4, and MKV media in PyWebView / WebView2.
"""

import http.server
import socketserver
import threading
import urllib.parse
import os
import sys
import mimetypes
import subprocess

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

class MediaStreamHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != '/stream':
            self.send_error(404, 'Not Found')
            return
        
        qs = urllib.parse.parse_qs(parsed.query)
        path = qs.get('path', [None])[0]
        if not path or not os.path.exists(path) or not os.path.isfile(path):
            self.send_error(404, 'File Not Found')
            return
            
        try:
            file_size = os.path.getsize(path)
        except OSError:
            self.send_error(500, 'Could not read file size')
            return

        # Determine MIME type
        ext = os.path.splitext(path)[1].lower()
        mime_map = {
            '.mp4': 'video/mp4',
            '.mov': 'video/quicktime',
            '.m4v': 'video/mp4',
            '.mkv': 'video/x-matroska',
            '.webm': 'video/webm',
            '.avi': 'video/x-msvideo',
            '.wmv': 'video/x-ms-wmv',
            '.mts': 'video/mp2t',
            '.m2ts': 'video/mp2t',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.aac': 'audio/aac',
            '.m4a': 'audio/mp4',
        }
        content_type = mime_map.get(ext) or mimetypes.guess_type(path)[0] or 'application/octet-stream'
        
        range_header = self.headers.get('Range')
        start = 0
        end = file_size - 1
        is_range = False
        
        if range_header and range_header.startswith('bytes='):
            is_range = True
            range_val = range_header[6:].strip()
            parts = range_val.split('-')
            try:
                if parts[0]:
                    start = int(parts[0])
                if len(parts) > 1 and parts[1]:
                    end = int(parts[1])
            except ValueError:
                pass
                
        end = min(end, file_size - 1)
        start = max(0, min(start, end))
        length = end - start + 1
        
        self.send_response(206 if is_range else 200)
        self.send_header('Content-Type', content_type)
        self.send_header('Accept-Ranges', 'bytes')
        if is_range:
            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
        self.send_header('Content-Length', str(length))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        
        try:
            with open(path, 'rb') as f:
                f.seek(start)
                remaining = length
                chunk_size = 128 * 1024
                while remaining > 0:
                    n = min(remaining, chunk_size)
                    buf = f.read(n)
                    if not buf:
                        break
                    self.wfile.write(buf)
                    remaining -= len(buf)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def log_message(self, format, *args):
        # Silence HTTP console logging
        pass

class MediaStreamerManager:
    _instance = None
    _lock = threading.Lock()

    def __init__(self):
        self.server = None
        self.port = None
        self.thread = None
        self._start_server()

    def _start_server(self):
        try:
            self.server = ThreadingHTTPServer(('127.0.0.1', 0), MediaStreamHandler)
            self.port = self.server.server_address[1]
            self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
            self.thread.start()
        except Exception as e:
            print(f"[MediaStreamer] Error starting local streaming server: {e}")
            self.port = None

    def get_stream_url(self, file_path):
        if not self.port or not file_path or not os.path.exists(file_path):
            return None
        quoted = urllib.parse.quote(os.path.normpath(file_path))
        return f"http://127.0.0.1:{self.port}/stream?path={quoted}"

    @classmethod
    def get_instance(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

def open_in_system_player(file_path):
    if not file_path or not os.path.exists(file_path):
        return {"error": "File does not exist"}
    target = os.path.normpath(file_path)
    try:
        if sys.platform == 'win32':
            os.startfile(target)
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', target])
        else:
            subprocess.Popen(['xdg-open', target])
        return {"success": True}
    except Exception as e:
        return {"error": str(e)}
