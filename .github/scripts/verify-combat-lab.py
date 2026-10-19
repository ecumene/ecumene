#!/usr/bin/env python3
"""Check canonical public URLs after publishing; never follow a redirect."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import http.client
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request


ORIGIN = "https://mitchellhynes.com"
DESTINATION = ORIGIN + "/combat-lab/"
TIME_LIMIT_SECONDS = 180
JAVASCRIPT_TYPES = ("application/javascript", "text/javascript")


@dataclass(frozen=True)
class Check:
    path: str
    status: int
    content_types: tuple = ()
    body_kind: str = ""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        return None


def public_checks():
    checks = []
    for prefix in ("/halo", "/halo-preview"):
        for suffix in ("", "/", "/index.html", "/halo.html"):
            checks.append(Check(prefix + suffix, 301))
        for suffix in ("/halo.js", "/halo.wasm", "/assets/ui/shell/halo-ce-ring-menu.jpg"):
            checks.append(Check(prefix + suffix, 404))
        checks.append(Check(prefix + "/coi-serviceworker.js", 200, JAVASCRIPT_TYPES, "retired"))
    for path in ("/combat-lab/", "/combat-lab/index.html"):
        checks.append(Check(path, 200, ("text/html",), "html"))
    checks.append(Check("/combat-lab/engine.js", 200, JAVASCRIPT_TYPES, "javascript"))
    checks.append(Check("/combat-lab/engine.wasm", 200, ("application/wasm",), "wasm"))
    checks.append(Check("/combat-lab/coi-serviceworker.js", 200, JAVASCRIPT_TYPES, "javascript"))
    return [(check, method) for check in checks for method in ("GET", "HEAD")]


def check_response(check, method, response, retired_worker):
    if response.status != check.status:
        return f"expected {check.status}, got {response.status}"
    if check.status == 301:
        location = response.headers.get("Location")
        return None if location == DESTINATION else f"wrong redirect location: {location!r}"
    if check.status == 404:
        return None

    content_type = response.headers.get_content_type()
    if content_type not in check.content_types:
        return f"unexpected content type: {content_type}"
    try:
        if int(response.headers.get("Content-Length", "0")) <= 0:
            return "missing or empty content length"
    except ValueError:
        return "invalid content length"
    if method == "HEAD":
        return None

    # Inspect only the required prefix; do not repeatedly download the WASM.
    limit = 262144 if check.body_kind == "html" else 512
    if check.body_kind == "wasm":
        limit = 8
    elif check.body_kind == "retired":
        limit = len(retired_worker) + 1
    body = response.read(limit)
    if not body:
        return "empty response body"
    if check.body_kind == "html" and not re.search(
        rb"<title>\s*Combat Lab\s*</title>", body, re.IGNORECASE
    ):
        return "Combat Lab title missing"
    if check.body_kind == "wasm" and body != b"\x00asm\x01\x00\x00\x00":
        return "invalid WebAssembly header"
    if check.body_kind == "javascript" and body.lstrip().lower().startswith((b"<!doctype", b"<html")):
        return "HTML returned in place of JavaScript"
    if check.body_kind == "retired" and body != retired_worker:
        return "old worker has not been replaced by the cleanup script"
    return None


def check_url(check, method, timeout, retired_worker):
    request = urllib.request.Request(
        ORIGIN + check.path,
        method=method,
        headers={
            "User-Agent": "Combat-Lab-deployment-check",
            "Cache-Control": "no-cache",
            "Accept-Encoding": "identity",
        },
    )
    try:
        try:
            response = urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return check_response(check, method, response, retired_worker)
    except (OSError, urllib.error.URLError, http.client.HTTPException) as error:
        return f"request failed: {error}"


def main():
    checks = public_checks()
    retired_worker = Path(__file__).with_name("retired-game-serviceworker.js").read_bytes()
    deadline = time.monotonic() + TIME_LIMIT_SECONDS
    failures = []

    def run_check(item):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return "verification deadline reached"
        return check_url(*item, min(5, remaining), retired_worker)

    with ThreadPoolExecutor(max_workers=8) as pool:
        while time.monotonic() < deadline:
            results = list(pool.map(run_check, checks))
            failures = [
                f"{method} {check.path}: {error}"
                for (check, method), error in zip(checks, results) if error
            ]
            if not failures:
                print(f"Verified {len(checks)} public GET/HEAD checks: redirects, retired files, runtime, and worker cleanup.")
                return 0
            print(f"Public responses not ready ({len(failures)}/{len(checks)}): " + "; ".join(failures[:4]), flush=True)
            remaining = deadline - time.monotonic()
            if remaining > 0:
                time.sleep(min(5, remaining))
    for failure in failures:
        print(failure, file=sys.stderr)
    print("Public verification did not pass within three minutes.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
