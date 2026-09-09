import http.server
import socketserver

PORT = 8903

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        if self.path.endswith(".js") or self.path.endswith(".html"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def guess_type(self, path):
        if path.endswith(".js"):
            return "text/javascript"
        return super().guess_type(path)

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving with COOP/COEP headers on port {PORT}")
    httpd.serve_forever()
