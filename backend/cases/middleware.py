import json
import logging
import time

from django.conf import settings
from django.http import JsonResponse
from django.utils.csp import CSP

api_log = logging.getLogger("cases.api")

# Values never written to the log, whatever their nesting.
_SECRET_KEYS = {"password", "csrfmiddlewaretoken", "token", "locktoken", "secret", "authorization", "sessionid"}

# Room for the multipart framing and the form fields around an uploaded file.
_FORM_OVERHEAD_BYTES = 64 * 1024


class RequestSizeLimitMiddleware:
    """Refuses a request whose declared body is larger than any upload may be, before anything
    reads it. Django otherwise streams the whole body to disk (the CSRF check alone reads it), and
    its own limits do not cover uploaded files. A reverse proxy should enforce the same limit for
    bodies sent without a length."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            declared = int(request.META.get("CONTENT_LENGTH") or 0)
        except ValueError:
            declared = 0
        if declared > settings.EVIDENCE_MAX_BYTES + _FORM_OVERHEAD_BYTES:
            limit = settings.EVIDENCE_MAX_BYTES // (1024 * 1024)
            return JsonResponse({"file": [f"Files must be {limit} MB or smaller."]}, status=413)
        return self.get_response(request)


# The admin site's own stylesheets, scripts and icons: everything from this origin, still never
# framed. Every other response keeps SECURE_CSP, which allows nothing (the API returns only JSON).
_ADMIN_CSP = {
    "default-src": [CSP.SELF],
    "img-src": [CSP.SELF, "data:"],
    "frame-ancestors": [CSP.NONE],
    "base-uri": [CSP.NONE],
    "form-action": [CSP.SELF],
}


class AdminCspMiddleware:
    """Gives the admin site's pages a policy that lets them load their own assets. It sets the
    same response attribute Django's csp_override decorator does, which the CSP middleware above
    it reads; listed after that middleware, it runs first on the way back."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith("/admin/"):
            response._csp_config = _ADMIN_CSP
        return response


def _masked_query(request) -> str:
    """The query string with any secret parameter's value masked (the editing lock's ?token=)."""
    params = request.GET.copy()
    for key in params:
        if key.lower() in _SECRET_KEYS:
            params.setlist(key, ["***"])
    return params.urlencode(safe="*")


def _redacted(value):
    if isinstance(value, dict):
        return {k: "***" if str(k).lower() in _SECRET_KEYS else _redacted(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_redacted(v) for v in value]
    return value


def _shown(value) -> str:
    """Pretty JSON for the log, cut to API_LOG_MAX_CHARS."""
    text = json.dumps(_redacted(value), indent=2, ensure_ascii=False, default=str)
    limit = settings.API_LOG_MAX_CHARS
    return text if len(text) <= limit else f"{text[:limit]}\n… ({len(text) - limit} more characters)"


class ApiLogMiddleware:
    """Writes every /api/ call to the "cases.api" log while API_LOG is on (by default, only with
    DEBUG): who called, the status and time taken, the JSON sent and the JSON returned. An upload
    is logged as its form fields and each file's name, type and size, never its contents; a
    download as the file's name and type. Secrets (passwords, tokens) are masked.

    It reads a JSON body before the view does (the view can still read it); a multipart body only
    afterwards, from what the view parsed, so uploads are not read twice."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not settings.API_LOG or not request.path.startswith("/api/"):
            return self.get_response(request)
        started = time.perf_counter()
        sent = self._json_body(request)
        response = self.get_response(request)
        took = (time.perf_counter() - started) * 1000
        if sent is None:
            sent = self._form_body(request)

        user = getattr(request, "user", None)
        who = user.email if user is not None and user.is_authenticated else "anonymous"
        query = f"?{_masked_query(request)}" if request.META.get("QUERY_STRING") else ""
        lines = [f"{request.method} {request.path}{query} → {response.status_code} ({took:.0f} ms) · {who}"]
        if sent is not None:
            lines.append(f"  request:\n{self._indent(_shown(sent))}")
        lines.append(f"  response:\n{self._indent(self._response_body(response))}")
        level = logging.WARNING if response.status_code >= 400 else logging.INFO
        api_log.log(level, "\n".join(lines))
        return response

    @staticmethod
    def _indent(text: str) -> str:
        return "\n".join(f"    {line}" for line in text.splitlines())

    @staticmethod
    def _json_body(request):
        if "json" not in (request.content_type or "") or not request.body:
            return None
        try:
            return json.loads(request.body)
        except (ValueError, UnicodeDecodeError):
            return {"(not JSON)": request.body[:200].decode("utf-8", "replace")}

    @staticmethod
    def _form_body(request):
        if "multipart" not in (request.content_type or "") and "form-urlencoded" not in (request.content_type or ""):
            return None
        try:
            fields = {k: v for k, v in request.POST.items()}
            for name, upload in request.FILES.items():
                fields[name] = f"<file {upload.name!r}, {upload.content_type}, {upload.size} bytes>"
        except Exception:  # noqa: BLE001 - the log never breaks the request it describes
            return {"(form)": "not readable after the view"}
        return fields

    @staticmethod
    def _response_body(response) -> str:
        if response.status_code == 204:
            return "(no content)"
        if getattr(response, "streaming", False):
            disposition = response.get("Content-Disposition", "")
            return f"<file download {disposition or ''} {response.get('Content-Type', '')}>".replace("  ", " ")
        content_type = response.get("Content-Type", "")
        if "json" not in content_type:
            return f"<{content_type or 'no content type'}, {len(response.content)} bytes>"
        try:
            return _shown(json.loads(response.content))
        except ValueError:
            return response.content[:200].decode("utf-8", "replace")
