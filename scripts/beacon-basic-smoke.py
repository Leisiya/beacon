#!/usr/bin/env python3
"""Exercise a zero-quota API key on the local Beacon instance, then remove it."""

import json
import pathlib
import time
import urllib.error
import urllib.request


BASE = "http://127.0.0.1:3000"
CREDS = pathlib.Path(__file__).resolve().parents[1] / ".local/admin-credentials.txt"


def request(path, method="GET", payload=None, access_token=None):
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if access_token:
        headers["Authorization"] = "Bearer " + access_token
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, None


def require_success(result, step):
    status, body = result
    if status != 200 or not isinstance(body, dict) or not body.get("success"):
        raise RuntimeError("%s failed (HTTP %s)" % (step, status))
    return body.get("data")


def list_tokens(access_token):
    data = require_success(
        request("/api/token/?p=1&page_size=100", access_token=access_token),
        "list tokens",
    )
    return data.get("items", [])


def main():
    fields = {}
    for line in CREDS.read_text().splitlines():
        if ":" in line:
            label, value = line.split(":", 1)
            fields[label.strip()] = value.strip()
    username = fields.get("用户名")
    password = fields.get("初始密码")
    if not username or not password:
        raise RuntimeError("local credential file is incomplete")

    unauth_status, _ = request("/api/token/")
    if unauth_status != 401:
        raise RuntimeError("unauthenticated token list did not return HTTP 401")

    login_data = require_success(
        request("/api/user/login", "POST", {"username": username, "password": password}),
        "local admin login",
    )
    access_token = login_data.get("access_token")
    if not access_token:
        raise RuntimeError("login requires an additional verification step")
    require_success(request("/api/user/self", access_token=access_token), "self profile")

    name = "beacon-local-smoke-%d" % time.time_ns()
    created_id = None
    try:
        require_success(
            request(
                "/api/token/",
                "POST",
                {
                    "name": name,
                    "remain_quota": 0,
                    "unlimited_quota": False,
                    "expired_time": -1,
                    "group": "default",
                },
                access_token,
            ),
            "create zero-quota token",
        )
        matches = [token for token in list_tokens(access_token) if token.get("name") == name]
        if len(matches) != 1:
            raise RuntimeError("created token was not found exactly once")
        created_id = matches[0]["id"]
        if "*" not in matches[0].get("key", ""):
            raise RuntimeError("token list returned an unmasked key")
        detail = require_success(
            request("/api/token/%d" % created_id, access_token=access_token),
            "read token detail",
        )
        if detail.get("remain_quota") != 0 or detail.get("unlimited_quota"):
            raise RuntimeError("zero-quota token limits changed")
        print("PASS: anonymous access rejected; admin profile and zero-quota key lifecycle verified; listed key masked")
    finally:
        if created_id is None:
            matches = [token for token in list_tokens(access_token) if token.get("name") == name]
            if len(matches) == 1:
                created_id = matches[0]["id"]
        if created_id is not None:
            require_success(
                request("/api/token/%d" % created_id, "DELETE", access_token=access_token),
                "delete test token",
            )
            if any(token.get("id") == created_id for token in list_tokens(access_token)):
                raise RuntimeError("test token remained after deletion")
            print("PASS: test key removed and absence confirmed")


if __name__ == "__main__":
    main()
