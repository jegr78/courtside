import http.client
import http.server
import os
import threading
import urllib.parse


MAX_REQUESTS = int(os.environ["COURTSIDE_SECURITY_MAX_REQUESTS"])
MAX_CONCURRENCY = int(os.environ["COURTSIDE_SECURITY_MAX_CONCURRENCY"])
MAX_BODY_BYTES = 2_000_000
UPSTREAM_HOST = "proxy"
UPSTREAM_PORT = 8080
ALLOWED_METHODS = frozenset(filter(None, os.environ.get(
    "COURTSIDE_SECURITY_ALLOWED_METHODS", "GET,HEAD,POST,OPTIONS").split(",")))
ALLOWED_PATH_PREFIXES = tuple(filter(None, os.environ.get(
    "COURTSIDE_SECURITY_ALLOWED_PATH_PREFIXES", "/").split(",")))
CANARY_ENABLED = os.environ.get("COURTSIDE_SECURITY_CANARY_ENABLED", "false") == "true"
CANARY_PATH = "/__security/zap-canary"
MAX_TARGET_BYTES = int(os.environ.get("COURTSIDE_SECURITY_MAX_TARGET_BYTES", "8192"))
counter_lock = threading.Lock()
concurrency = threading.BoundedSemaphore(MAX_CONCURRENCY)
request_count = 0


class RequestHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        self.forward()

    def do_HEAD(self):
        self.forward()

    def do_POST(self):
        self.forward()

    def do_OPTIONS(self):
        self.forward()

    def forward(self):
        global request_count
        parsed = urllib.parse.urlsplit(self.path)
        if not target_allowed(parsed, self.command):
            self.reject(421)
            return
        if not concurrency.acquire(blocking=False):
            self.reject(429)
            return
        try:
            with counter_lock:
                if request_count >= MAX_REQUESTS:
                    self.reject(429)
                    return
                request_count += 1
                self.write_count()
            path = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
            if CANARY_ENABLED and parsed.path == CANARY_PATH:
                self.send_canary()
                return
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.reject(400)
                return
            if content_length < 0 or content_length > MAX_BODY_BYTES:
                self.reject(413)
                return
            body = self.rfile.read(content_length) if content_length else None
            headers = {name: value for name, value in self.headers.items()
                       if name.lower() not in {"connection", "host", "proxy-connection", "transfer-encoding"}}
            headers["Host"] = "proxy"
            connection = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=10)
            try:
                connection.request(self.command, path, body=body, headers=headers)
                response = connection.getresponse()
                response_length = response.getheader("Content-Length")
                if response_length is not None and int(response_length) > MAX_BODY_BYTES:
                    self.reject(502)
                    return
                payload = response.read(MAX_BODY_BYTES + 1)
                if len(payload) > MAX_BODY_BYTES:
                    self.reject(502)
                    return
            except (OSError, ValueError, http.client.HTTPException):
                self.reject(502)
                return
            self.send_response(response.status)
            for name, value in response.getheaders():
                if name.lower() not in {"connection", "content-length", "transfer-encoding"}:
                    self.send_header(name, value)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)
            connection.close()
        finally:
            concurrency.release()

    def reject(self, status):
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_canary(self):
        payload = b"Courtside scanner canary"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("X-Powered-By", "Courtside-ZAP-Canary/1.0")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def write_count(self):
        temporary = "/tmp/security-gateway-count.next"
        with open(temporary, "w", encoding="ascii") as output:
            output.write(str(request_count))
        os.replace(temporary, "/tmp/security-gateway-count")

    def log_message(self, format, *args):
        return


def target_allowed(parsed, method):
    if method not in ALLOWED_METHODS:
        return False
    if len(parsed.geturl().encode("utf-8")) > MAX_TARGET_BYTES or parsed.username or parsed.password:
        return False
    if parsed.scheme or parsed.netloc:
        if parsed.scheme != "http" or parsed.hostname != "scanner-gateway" or parsed.port != 8090:
            return False
    path = parsed.path or "/"
    return any(path == prefix or path.startswith(f"{prefix.rstrip('/')}/")
               for prefix in ALLOWED_PATH_PREFIXES)


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("0.0.0.0", 8090), RequestHandler)
    server.serve_forever()
