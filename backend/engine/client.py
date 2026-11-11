"""The only code that talks to the Data Authentication API. Nothing it returns is handed to the
browser as-is: callers adapt it first, and engine ids and URLs stay on the server."""

import json
import time
from contextlib import contextmanager
from functools import cache
from typing import NamedTuple

import httpx
from django.conf import settings


class RunNotFound(Exception):
    """The engine has no record of the run (lost in an engine restart, say). Unlike
    EngineUnavailable, waiting will not help."""


class EngineUnavailable(Exception):
    """The engine could not be reached or answered with an error. Callers turn this into a 503
    for the frontend, never a 500, and never with the engine's own message."""


class EngineUnconfirmed(EngineUnavailable):
    """A submission was sent in full but the engine did not answer in time. Unlike a refusal, it may
    have accepted the run and be working on it: sending it again starts a second run."""


@cache
def _client() -> httpx.Client:
    # One pooled client per process: connections are reused across requests.
    return httpx.Client(
        base_url=settings.ENGINE_BASE_URL,
        timeout=httpx.Timeout(settings.ENGINE_TIMEOUT_SECONDS, connect=5.0),
        headers={"Accept": "application/json"},
        follow_redirects=False,
    )


def _get_json(path: str, *, missing_ok: bool = False, **params) -> dict | None:
    """GET a JSON document. With missing_ok, 409 (not ready yet) and 422 (declined: not
    produced for this submission) return None instead of raising."""
    try:
        response = _client().get(path, params={k: v for k, v in params.items() if v is not None})
        if missing_ok and response.status_code in (409, 422):
            return None
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise EngineUnavailable(f"GET {path} failed") from exc


def evidence_options() -> dict:
    """The evidence dropdown catalogue: {questions: {qid: [option, ...]}, jurisdiction, ...}."""
    return _get_json("/authentication/evidence-options")


def _upload_seconds() -> float:
    """How long uploading every document may take, start to finish."""
    return settings.ENGINE_TIMEOUT_SECONDS * 4


def _send_timeout() -> httpx.Timeout:
    t = settings.ENGINE_TIMEOUT_SECONDS
    return httpx.Timeout(connect=5.0, pool=5.0, write=t, read=t * 2)


def submit_max_seconds() -> float:
    """The longest a send can take. The upload stops at its deadline; past that, one blocked write
    and the wait for the engine's reply are all that remain, and each has its own timeout."""
    timeout = _send_timeout()
    return timeout.connect + timeout.pool + _upload_seconds() + timeout.write + timeout.read


class _UntilDeadline:
    """A document as the upload reads it, refusing reads once the upload's deadline has passed.
    httpx's timeouts limit each network step; this limits the upload as a whole."""

    def __init__(self, fh, deadline: float):
        self._fh, self._deadline = fh, deadline

    def read(self, size: int = -1) -> bytes:
        if time.monotonic() > self._deadline:
            raise EngineUnavailable("POST /authentication/verify: the upload ran past its deadline")
        return self._fh.read(size)

    def __getattr__(self, name):
        return getattr(self._fh, name)


class Accepted(NamedTuple):
    """The engine's answer to a submission. It keeps one request id per application: a resubmission
    comes back with the application's request id and a new submission version ("V001" for the first
    resubmission, then "V002" ...); a first submission has none."""

    request_id: str
    submission_version: str | None = None


def submit(payload: dict, files: list[tuple[str, object, str, str]]) -> Accepted:
    """Starts a run. files are (file name, file object, content type, doc_type). Returns the
    engine's request id, and its submission version on a resubmission. Never takes longer than
    submit_max_seconds()."""
    deadline = time.monotonic() + _upload_seconds()
    try:
        response = _client().post(
            "/authentication/verify",
            files=[("form_data", ("form_data.json", json.dumps(payload).encode(), "application/json"))]
            + [("evidence", (name, _UntilDeadline(fh, deadline), ctype)) for name, fh, ctype, _ in files],
            data={"evidence_doc_types": [doc_type for *_, doc_type in files]},
            timeout=_send_timeout(),
        )
        response.raise_for_status()
        body = response.json()
        version = body.get("submission_version")
        return Accepted(body["request_id"], str(version) if version else None)
    except httpx.ReadTimeout as exc:
        raise EngineUnconfirmed("POST /authentication/verify sent, but not answered in time") from exc
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise EngineUnavailable("POST /authentication/verify failed") from exc


def status(request_id: str) -> dict:
    path = f"/authentication/status/{request_id}"
    try:
        response = _client().get(path)
        if response.status_code == 404:
            raise RunNotFound(request_id)
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise EngineUnavailable(f"GET {path} failed") from exc


class ForceRefused(Exception):
    """The engine would not force the run on to scoring: no run has both ids (404), or it cannot
    be forced as it stands (409: still running, already CLEAR, already forced, or too old). The
    message is the engine's reason, for the reviewer."""


def force_score(request_id: str, application_id: str) -> dict:
    """Moves a run that did not authenticate CLEAR on to scoring and the assessment, after the
    reviewer accepted every finding. The engine sets its outcome to CLEAR and resumes the same run:
    the score and assessment then appear at their usual endpoints for this request id."""
    path = "/authentication/force-score"
    try:
        response = _client().post(
            path, json={"request_id": request_id, "application_id": application_id, "is_score_forced": True}
        )
        if response.status_code in (404, 409):
            raise ForceRefused(_detail(response) or f"The engine refused (HTTP {response.status_code}).")
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise EngineUnavailable(f"POST {path} failed") from exc


def _detail(response: httpx.Response) -> str:
    """The engine's own explanation of a refusal, as plain text."""
    try:
        detail = response.json().get("detail")
    except (ValueError, AttributeError):
        return ""
    if isinstance(detail, str):
        return detail[:500]
    if isinstance(detail, dict):
        return str(detail.get("message") or detail.get("reason") or "")[:500]
    return ""


def result(request_id: str) -> dict | None:
    return _get_json(f"/authentication/result/{request_id}", missing_ok=True)


def score(request_id: str) -> dict | None:
    return _get_json(f"/authentication/score/{request_id}", missing_ok=True)


def assessment(request_id: str) -> dict | None:
    return _get_json(f"/authentication/assessment/{request_id}", missing_ok=True)


@contextmanager
def highlight(request_id: str, name: str):
    """Streams one highlighted evidence PDF. Yields the open response; 404 when the engine has
    no such file."""
    try:
        with _client().stream("GET", f"/authentication/evidence-highlight/{request_id}/{name}") as response:
            if response.status_code == 404:
                yield None
                return
            response.raise_for_status()
            yield response
    except httpx.HTTPError as exc:
        raise EngineUnavailable("GET evidence-highlight failed") from exc
