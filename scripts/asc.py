#!/usr/bin/env python3
"""Minimal App Store Connect API client, authenticated with an ASC API key (no Apple-ID session).

Env: ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID (same as scripts/publish-testflight.sh).

    python3 scripts/asc.py get /v1/apps "filter[bundleId]=com.lukaschylik.dualmind"
"""
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

import jwt  # PyJWT with cryptography (ES256)

API = "https://api.appstoreconnect.apple.com"
# python.org builds ship without CA roots; fall back to the macOS bundle.
SSL = ssl.create_default_context(cafile="/etc/ssl/cert.pem" if os.path.exists("/etc/ssl/cert.pem") else None)


def token():
    key = open(os.path.expanduser(os.environ["ASC_KEY_PATH"])).read()
    now = int(time.time())
    return jwt.encode(
        {"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 15 * 60, "aud": "appstoreconnect-v1"},
        key, algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"},
    )


def call(method, path, body=None, query=""):
    url = API + path + (("?" + query) if query else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, context=SSL) as res:
            raw = res.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> {e.code}\n{e.read().decode()}")


def upload_parts(operations, payload):
    """Uploads a file to the URLs an asset reservation hands back."""
    for op in operations:
        chunk = payload[op["offset"]:op["offset"] + op["length"]]
        req = urllib.request.Request(op["url"], data=chunk, method=op["method"],
                                     headers={h["name"]: h["value"] for h in op["requestHeaders"]})
        urllib.request.urlopen(req, context=SSL).read()


if __name__ == "__main__":
    method, path = sys.argv[1].upper(), sys.argv[2]
    arg = sys.argv[3] if len(sys.argv) > 3 else ""
    if method == "GET":
        print(json.dumps(call("GET", path, query=arg), indent=2))
    else:
        print(json.dumps(call(method, path, body=json.loads(arg) if arg else None), indent=2))
