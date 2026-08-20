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
            parsed = urllib.parse.urlsplit(self.path)
            path = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
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

    def write_count(self):
        temporary = "/tmp/security-gateway-count.next"
        with open(temporary, "w", encoding="ascii") as output:
            output.write(str(request_count))
        os.replace(temporary, "/tmp/security-gateway-count")

    def log_message(self, format, *args):
        return


server = http.server.ThreadingHTTPServer(("0.0.0.0", 8090), RequestHandler)
server.serve_forever()
