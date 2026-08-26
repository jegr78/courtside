import collections
import http.client
import http.server
import json
import os
import threading
import time
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
MAX_GENERATED_BYTES = int(os.environ["COURTSIDE_SECURITY_MAX_GENERATED_BYTES"])
counter_lock = threading.Lock()
concurrency = threading.BoundedSemaphore(MAX_CONCURRENCY)
request_count = 0
request_bytes = 0
upstream_errors = 0
latencies = collections.deque(maxlen=2048)
upstream_outcomes = collections.deque(maxlen=2048)


class RequestHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # Every method reaches forward(), where the cap decides. Left to the base class, one it has no
    # do_ handler for would be answered 501 - a server error the assessment reads as the target's.
    def __getattr__(self, name):
        if name.startswith("do_"):
            return self.forward
        raise AttributeError(name)

    def forward(self):
        global request_count, request_bytes
        parsed = urllib.parse.urlsplit(self.path)
        canonical_path = canonical_target_path(parsed.path)
        if canonical_path is None or not target_allowed(parsed, self.command, canonical_path):
            self.reject(421)
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.reject(400)
            return
        if content_length < 0:
            self.reject(400)
            return
        with counter_lock:
            if request_count >= MAX_REQUESTS or request_bytes + content_length > MAX_GENERATED_BYTES:
                self.reject(429)
                return
            request_count += 1
            request_bytes += content_length
            self.write_metrics()
        if content_length > MAX_BODY_BYTES:
            self.reject(413)
            return
        if not concurrency.acquire(blocking=False):
            self.reject(429)
            return
        try:
            path = urllib.parse.urlunsplit(("", "", canonical_path, parsed.query, ""))
            if CANARY_ENABLED and canonical_path == CANARY_PATH:
                self.send_canary()
                return
            body = self.rfile.read(content_length) if content_length else None
            headers = {name: value for name, value in self.headers.items()
                       if name.lower() not in {"connection", "host", "proxy-connection", "transfer-encoding"}}
            headers["Host"] = "proxy"
            connection = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=10)
            started = time.monotonic()
            response_status = 502
            try:
                connection.request(self.command, path, body=body, headers=headers)
                response = connection.getresponse()
                response_status = response.status
                response_length = response.getheader("Content-Length")
                if response_length is not None and int(response_length) > MAX_BODY_BYTES:
                    self.reject(502)
                    return
                payload = response.read(MAX_BODY_BYTES + 1)
                if len(payload) > MAX_BODY_BYTES:
                    self.reject(502)
                    return
            except (OSError, ValueError, http.client.HTTPException):
                self.record_upstream(response_status, started)
                self.reject(502)
                return
            self.record_upstream(response_status, started)
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
        self.close_connection = True
        self.send_response(status)
        self.send_header("Connection", "close")
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

    def write_metrics(self):
        temporary = "/tmp/security-gateway-metrics.next"
        ordered = sorted(latencies)
        percentile_index = max(0, (len(ordered) * 95 + 99) // 100 - 1)
        p95 = ordered[percentile_index] if ordered else 0
        error_rate = sum(upstream_outcomes) / len(upstream_outcomes) if upstream_outcomes else 0
        with open(temporary, "w", encoding="ascii") as output:
            json.dump({"requests": request_count, "requestBytes": request_bytes,
                       "upstreamErrors": upstream_errors, "requestP95Milliseconds": p95,
                       "errorRate": error_rate}, output, separators=(",", ":"))
        os.replace(temporary, "/tmp/security-gateway-metrics")

    def record_upstream(self, status, started):
        global upstream_errors
        with counter_lock:
            latencies.append((time.monotonic() - started) * 1000)
            failed = status >= 500
            upstream_outcomes.append(1 if failed else 0)
            if failed:
                upstream_errors += 1
            self.write_metrics()

    def log_message(self, format, *args):
        return


def canonical_target_path(path):
    candidate = path or "/"
    if not candidate.startswith("/") or "%" in candidate or "\\" in candidate:
        return None
    try:
        candidate.encode("ascii")
    except UnicodeEncodeError:
        return None
    if "//" in candidate or any(segment in {".", ".."} for segment in candidate.split("/")):
        return None
    return candidate


def target_allowed(parsed, method, canonical_path=None):
    if method not in ALLOWED_METHODS:
        return False
    if len(parsed.geturl().encode("utf-8")) > MAX_TARGET_BYTES or parsed.username or parsed.password:
        return False
    if parsed.scheme or parsed.netloc:
        if parsed.scheme != "http" or parsed.hostname != "scanner-gateway" or parsed.port != 8090:
            return False
    path = canonical_path if canonical_path is not None else canonical_target_path(parsed.path)
    if path is None:
        return False
    return any(path == prefix or path.startswith(f"{prefix.rstrip('/')}/")
               for prefix in ALLOWED_PATH_PREFIXES)


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(
        ("0.0.0.0", int(os.environ.get("COURTSIDE_SECURITY_GATEWAY_PORT", "8090"))), RequestHandler)
    print(f"listening {server.server_address[1]}", flush=True)
    server.serve_forever()
