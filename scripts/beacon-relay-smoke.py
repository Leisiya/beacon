#!/usr/bin/env python3
"""Run real gateway/accounting requests against a local, explicit mock upstream.

Creates its own temporary SQLite database, accounts, channels and credentials.
Never reads .env.beacon.local or the developer's administrator credentials.
Requires a current .local/bin/beacon-dev build. All fixtures are removed on exit.
This verifies local integration, not any commercial upstream or cost price.
"""

import concurrent.futures
import json
import os
import pathlib
import secrets
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODEL = "beacon-mock-chat"
RETRY_MODEL = "beacon-mock-retry"
FIXED_MODEL = "beacon-mock-fixed"
UPSTREAM_KEY = "mock-only-" + secrets.token_hex(24)
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


class MockUpstream(BaseHTTPRequestHandler):
    calls = []
    lock = threading.Lock()
    barrier = threading.Barrier(2)
    limited_entered = threading.Event()
    limited_release = threading.Event()

    def log_message(self, *_args):
        pass

    def do_POST(self):
        if self.headers.get("Authorization") != "Bearer " + UPSTREAM_KEY:
            self.send_error(401)
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        marker = body.get("messages", [{}])[-1].get("content", "")
        with self.lock:
            self.calls.append((self.path, marker))
        if self.path.startswith("/primary/") or marker == "mock-error":
            data = json.dumps({"error": {"message": "explicit local mock failure", "type": "server_error", "code": "mock_failure"}}).encode()
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if marker == "mock-concurrent":
            self.barrier.wait(timeout=15)
        if marker == "mock-limited":
            self.limited_entered.set()
            if not self.limited_release.wait(timeout=15):
                self.send_error(504)
                return
        usage = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
        response = {"id": "mock-local-completion", "object": "chat.completion", "created": int(time.time()), "model": body["model"], "choices": [{"index": 0, "message": {"role": "assistant", "content": "MOCK: local test only"}, "finish_reason": "stop"}], "usage": usage}
        self.send_response(200)
        self.send_header("x-request-id", "mock-upstream-request")
        if body.get("stream"):
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            chunks = [
                {"id": response["id"], "object": "chat.completion.chunk", "created": response["created"], "model": body["model"], "choices": [{"index": 0, "delta": {"role": "assistant", "content": "MOCK: local test only"}, "finish_reason": None}]},
                {"id": response["id"], "object": "chat.completion.chunk", "created": response["created"], "model": body["model"], "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": usage},
            ]
            for chunk in chunks:
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())


class Gateway:
    def __init__(self, port):
        self.base = "http://127.0.0.1:" + str(port)

    def request(self, path, method="GET", payload=None, token=None, proof=None):
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        if proof:
            headers["X-Security-Proof"] = proof
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload).encode()
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            response = HTTP.open(request, timeout=25)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            content = response.read()
            if "text/event-stream" in response.headers.get("Content-Type", ""):
                return response.status, content.decode()
            return response.status, json.loads(content)

    def ok(self, path, method="GET", payload=None, token=None, proof=None):
        status, body = self.request(path, method, payload, token, proof)
        check(status == 200 and body.get("success"), f"{method} {path} failed (HTTP {status}; {body.get('code', 'business failure')})")
        return body.get("data")

    def login(self, username, password):
        return self.ok("/api/user/login", "POST", {"username": username, "password": password})["access_token"]

    def grant(self, root_token, password, user_id, quota):
        entry = {"idempotency_key": "mock-grant-" + secrets.token_hex(12), "kind": "gift", "user_id": user_id, "quota": quota, "occurred_at": int(time.time()), "note": "MOCK: isolated local relay verification; no real funds"}
        verification = self.ok("/api/verify", "POST", {"method": "password", "scope": "beacon.ledger.post", "password": password, "context": {"entry": entry}}, root_token)
        self.ok("/api/beacon/ledger", "POST", entry, root_token, verification["proof_token"])

    def key(self, token, name, quota=10000, limit_model=MODEL):
        self.ok("/api/token/", "POST", {"name": name, "remain_quota": quota, "unlimited_quota": False, "expired_time": -1, "group": "default", "model_limits_enabled": True, "model_limits": limit_model}, token)
        rows = self.ok("/api/token/?p=1&page_size=100", token=token)["items"]
        row = next(row for row in rows if row["name"] == name)
        check("*" in row["key"], "token list must mask the secret")
        key = self.ok(f"/api/token/{row['id']}/key", "POST", {}, token)["key"]
        return row["id"], "sk-" + key

    def relay(self, key, marker, model=MODEL, stream=False):
        payload = {"model": model, "messages": [{"role": "user", "content": marker}], "max_tokens": 10, "stream": stream}
        if stream:
            payload["stream_options"] = {"include_usage": True}
        return self.request("/v1/chat/completions", "POST", payload, key)

    def balance(self, token):
        return self.ok("/api/user/self", token=token)["quota"]

    def logs(self, token):
        return self.ok("/api/log/self?type=2&p=1&page_size=100", token=token)["items"]


def wait_until(predicate, message, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise RuntimeError(message)


def exercise(gateway, mock_url, password):
    gateway.ok("/api/setup", "POST", {"username": "mockroot", "password": password, "confirmPassword": password, "SelfUseModeEnabled": False, "DemoSiteEnabled": False})
    root = gateway.login("mockroot", password)
    users = []
    for name in ("mockalice", "mockbob", "mocklimited"):
        gateway.ok("/api/user/register", "POST", {"username": name, "password": password})
        token = gateway.login(name, password)
        profile = gateway.ok("/api/user/self", token=token)
        check(profile["role"] == 1 and profile["quota"] == 0, "registered user must be ordinary with no initial balance")
        users.append((token, profile["id"]))
    alice, alice_id = users[0]
    bob, bob_id = users[1]
    limited, limited_id = users[2]
    gateway.grant(root, password, alice_id, 10000)
    gateway.grant(root, password, bob_id, 10000)
    gateway.grant(root, password, limited_id, 15)

    snapshot = gateway.ok("/api/option/model_pricing?model=" + MODEL + "&model=" + RETRY_MODEL + "&model=" + FIXED_MODEL, token=root)
    versions = {row["model_name"]: row["version"] for row in snapshot["entries"]}
    # Deliberately artificial test rates: 1 quota per input/output token. These
    # are runtime test configuration, never production model prices or costs.
    gateway.ok("/api/option/model_pricing", "PATCH", {"changes": [{"model_name": name, "expected_version": versions.get(name, snapshot["empty_version"]), "pricing": {"ModelRatio": 1, "CompletionRatio": 1}} for name in (MODEL, RETRY_MODEL)]}, root)
    gateway.ok("/api/option/model_pricing", "PATCH", {"changes": [{"model_name": FIXED_MODEL, "expected_version": versions.get(FIXED_MODEL, snapshot["empty_version"]), "pricing": {"ModelPrice": 0.00003}}]}, root)
    for name, path, model, priority in (("MOCK normal", "normal", MODEL, 0), ("MOCK retry primary", "primary", RETRY_MODEL, 100), ("MOCK retry fallback", "fallback", RETRY_MODEL, 0), ("MOCK fixed", "normal", FIXED_MODEL, 0)):
        gateway.ok("/api/channel/", "POST", {"mode": "single", "channel": {"type": 1, "name": name, "key": UPSTREAM_KEY, "base_url": mock_url + "/" + path, "models": model, "group": "default", "priority": priority, "status": 1, "auto_ban": 0}}, root)

    key_id, key = gateway.key(alice, "MOCK Alice", limit_model=MODEL + "," + RETRY_MODEL)
    bob_key_id, bob_key = gateway.key(bob, "MOCK Bob")
    _, blocked_key = gateway.key(alice, "MOCK empty key", quota=0)

    def settled(expected_balance, expected_count):
        wait_until(lambda: gateway.balance(alice) == expected_balance and len(gateway.logs(alice)) == expected_count, "wallet settlement or consume-log count mismatch")

    status, body = gateway.relay(key, "mock-success")
    check(status == 200 and body["choices"][0]["message"]["content"] == "MOCK: local test only", "non-streaming relay failed")
    settled(9985, 1)
    status, body = gateway.relay(key, "mock-stream", stream=True)
    check(status == 200 and "[DONE]" in body and "MOCK: local test only" in body, "streaming relay failed")
    settled(9970, 2)

    before = len(MockUpstream.calls)
    status, _ = gateway.relay(blocked_key, "mock-blocked")
    check(status != 200 and len(MockUpstream.calls) == before, "empty key must be rejected before upstream")
    status, _ = gateway.relay(bob_key, "mock-forbidden-model", RETRY_MODEL)
    check(status != 200 and len(MockUpstream.calls) == before, "model limit must be enforced before upstream")

    status, _ = gateway.relay(key, "mock-error")
    check(status == 503, "upstream failure must remain a failed response")
    settled(9970, 2)
    print("PASS: real registration/login/key flow; JSON and SSE debit exactly 15 each; failures release reservations; key and model limits block upstream")

    gateway.ok("/api/option/", "PUT", {"key": "RetryTimes", "value": "1"}, root)
    status, _ = gateway.relay(key, "mock-retry", RETRY_MODEL)
    check(status == 200, "retry must recover through the fallback channel")
    paths = [path for path, marker in MockUpstream.calls if marker == "mock-retry"]
    check(len(paths) == 2 and paths[0].startswith("/primary/") and paths[1].startswith("/fallback/"), "retry must use the intended failed and successful channels")
    settled(9955, 3)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(gateway.relay, key, "mock-concurrent") for _ in range(2)]
        check(all(f.result()[0] == 200 for f in futures), "concurrent relay failed")
    settled(9925, 5)
    token_row = gateway.ok(f"/api/token/{key_id}", token=alice)
    check(token_row["remain_quota"] == 9925 and token_row["used_quota"] == 75, "key settlement must match wallet settlement")
    logs = gateway.logs(alice)
    check(all(row["quota"] == 15 and row["prompt_tokens"] == 10 and row["completion_tokens"] == 5 for row in logs), "log usage and settled quota must match upstream fixture")
    check(len({row["request_id"] for row in logs}) == 5, "successful requests must have distinct correlations")
    check(all("admin_info" not in json.loads(row["other"]) and "root_info" not in json.loads(row["other"]) for row in logs), "ordinary users must not receive privileged log metadata")
    print("PASS: failed-first-channel retry charges once; concurrent requests debit wallet/key exactly and produce separate usage logs")

    check(gateway.balance(bob) == 10000 and gateway.logs(bob) == [], "Alice usage must not change Bob balance or logs")
    _, detail = gateway.request(f"/api/token/{bob_key_id}", token=alice)
    check(not detail.get("success"), "Alice must not read Bob key details")
    _, secret = gateway.request(f"/api/token/{bob_key_id}/key", "POST", {}, alice)
    check(not secret.get("success"), "Alice must not retrieve Bob secret")
    status, _ = gateway.request("/api/beacon/ledger?view=cash_summary", token=alice)
    check(status in (401, 403), "ordinary user must not read whole-site cash")
    foreign = gateway.ok(f"/api/log/self?type=2&user_id={alice_id}&p=1&page_size=100", token=bob)
    check(foreign["items"] == [], "query parameters must not bypass log ownership")
    print("PASS: balances, keys, secrets, usage logs and whole-site cash remain isolated between users")

    # Hold one request at the upstream while a second key attempts to spend
    # the same wallet. This is a deterministic overlap, not a timing stress test.
    _, limited_key = gateway.key(limited, "MOCK limited A", limit_model=FIXED_MODEL)
    _, second_key = gateway.key(limited, "MOCK limited B", limit_model=FIXED_MODEL)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(gateway.relay, limited_key, "mock-limited", FIXED_MODEL)
        try:
            check(MockUpstream.limited_entered.wait(timeout=10), "first limited request never reached the mock")
            before = len(MockUpstream.calls)
            status, _ = gateway.relay(second_key, "mock-insufficient", FIXED_MODEL)
            check(status != 200 and len(MockUpstream.calls) == before, "in-flight reservation must block another key from overspending the same wallet")
        finally:
            MockUpstream.limited_release.set()
        check(pending.result()[0] == 200, "reserved fixed-price request failed")
    wait_until(lambda: gateway.balance(limited) == 0 and len(gateway.logs(limited)) == 1, "limited wallet must settle exactly to zero")
    check(gateway.logs(limited)[0]["quota"] == 15, "fixed-price deduction mismatch")
    print("PASS: one-request wallet budget cannot be spent twice through overlapping calls on different keys")

    old_by_request = {row["request_id"]: (row["quota"], row["other"]) for row in logs}
    snapshot = gateway.ok("/api/option/model_pricing?model=" + MODEL, token=root)
    version = next(row["version"] for row in snapshot["entries"] if row["model_name"] == MODEL)
    gateway.ok("/api/option/model_pricing", "PATCH", {"changes": [{"model_name": MODEL, "expected_version": version, "pricing": {"ModelRatio": 2, "CompletionRatio": 1}}]}, root)
    status, _ = gateway.relay(key, "mock-new-price")
    check(status == 200, "request at new price failed")
    settled(9895, 6)
    current = gateway.logs(alice)
    for row in current:
        if row["request_id"] in old_by_request:
            check((row["quota"], row["other"]) == old_by_request[row["request_id"]], "new prices must not rewrite historical usage snapshots")
        else:
            check(row["quota"] == 30, "new price must apply only to subsequent usage")
    print("PASS: model price change affects new calls while prior debit and pricing snapshots remain unchanged")


def main():
    binary = ROOT / ".local/bin/beacon-dev"
    check(binary.is_file(), "Build the local Beacon binary first")
    mock = ThreadingHTTPServer(("127.0.0.1", 0), MockUpstream)
    thread = threading.Thread(target=mock.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="beacon-relay-smoke-") as temporary:
            folder = pathlib.Path(temporary)
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]
            version = "beacon-isolated-mock-" + secrets.token_hex(8)
            # Whitelist the environment: never inherit production DB, Redis,
            # proxy, telemetry, mail or payment configuration from the caller.
            env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "SystemRoot") if key in os.environ}
            env.update({"PORT": str(port), "VERSION": version, "SQLITE_PATH": str(folder / "test.db"), "SESSION_SECRET": secrets.token_hex(32), "CRYPTO_SECRET": secrets.token_hex(32), "CRITICAL_RATE_LIMIT": "200", "MEMORY_CACHE_ENABLED": "false", "SHUTDOWN_TIMEOUT_SECONDS": "2", "GIN_MODE": "release"})
            with (folder / "server.log").open("wb") as log:
                process = subprocess.Popen([str(binary), "--log-dir", str(folder / "logs")], cwd=folder, env=env, stdout=log, stderr=subprocess.STDOUT)
                try:
                    gateway = Gateway(port)

                    def ready():
                        check(process.poll() is None, "isolated gateway exited before startup")
                        try:
                            status, body = gateway.request("/api/status")
                        except (urllib.error.URLError, ConnectionError):
                            return False
                        check(status == 200 and body.get("data", {}).get("version") == version, "test port does not belong to this isolated gateway")
                        return True

                    wait_until(ready, "isolated gateway startup timeout", 30)
                    exercise(gateway, f"http://127.0.0.1:{mock.server_port}", "Mock-test-" + secrets.token_hex(20))
                finally:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
    finally:
        mock.shutdown()
        mock.server_close()
        thread.join(timeout=5)
    print("CLEANED: temporary gateway, mock upstream, database, logs and credentials removed; developer data untouched")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, AssertionError) as error:
        raise SystemExit("FAIL: " + str(error)) from None
