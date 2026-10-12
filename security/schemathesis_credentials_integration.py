import json
from pathlib import Path
from types import SimpleNamespace

import requests

Path("/tmp/courtside-credentials.json").write_text(
    json.dumps({"session": "session-value", "csrfCookie": "csrf%2Bcookie", "csrfToken": "csrf+cookie"}),
    encoding="utf-8")

import schemathesis
from hypothesis import HealthCheck, Phase, given, settings
from schemathesis.core.parameters import ParameterLocation
from schemathesis.generation import GenerationMode
from schemathesis.generation.meta import (CaseMetadata, ComponentInfo, CoveragePhaseData, CoverageScenario,
                                         GenerationInfo, PhaseInfo, TestPhase)

from schemathesis_credentials import before_call

SUPPLIED = {"__Host-SESSION": "session-value", "__Host-XSRF-TOKEN": "csrf%2Bcookie"}


def sent(case, cookies=None, headers=None):
    kwargs = {}
    before_call(None, case, kwargs)
    cookie = "; ".join(f"{name}={value}" for name, value in (cookies or {}).items())
    request = requests.Request("POST", "https://localhost/api/admin/audit",
                               headers={**({"Cookie": cookie} if cookie else {}), **(headers or {})}).prepare()
    kwargs["auth"](request)
    received = dict(pair.split("=", 1) for pair in request.headers.get("Cookie", "").split("; ") if "=" in pair)
    return received, request.headers


def positive_case():
    meta = CaseMetadata(generation=GenerationInfo(time=0.0, mode=GenerationMode.POSITIVE),
                        components={ParameterLocation.COOKIE: ComponentInfo(mode=GenerationMode.POSITIVE)},
                        phase=PhaseInfo(name=TestPhase.FUZZING, data=None))
    return SimpleNamespace(meta=meta)


cookies, headers = sent(positive_case(), headers={"X-XSRF-TOKEN": "generated"})
assert cookies == SUPPLIED, f"a positive case carries both credential cookies, got {cookies}"
assert headers["X-XSRF-TOKEN"] == "csrf+cookie", "a positive case carries the real CSRF header"

cookies, headers = sent(positive_case(), cookies={"probe": "a=b"}, headers={"x-xsrf-token": "generated"})
assert cookies == {"probe": "a=b", **SUPPLIED}, f"a generated cookie survives beside the credentials, got {cookies}"
assert headers["X-XSRF-TOKEN"] == "csrf+cookie" and list(headers).count("x-xsrf-token") == 0, \
    "the CSRF header replaces a generated one regardless of its case"

schema = schemathesis.openapi.from_dict({
    "openapi": "3.0.3", "info": {"title": "credentials", "version": "1"},
    "components": {"securitySchemes": {
        "sessionCookie": {"type": "apiKey", "in": "cookie", "name": "__Host-SESSION"},
        "csrfToken": {"type": "apiKey", "in": "header", "name": "X-XSRF-TOKEN"}}},
    "paths": {"/api/admin/audit": {"post": {"security": [{"sessionCookie": [], "csrfToken": []}],
                                            "responses": {"204": {"description": "recorded"}}}}}})
shapes = set()


@settings(max_examples=200, database=None, derandomize=True, deadline=None, phases=[Phase.generate],
          suppress_health_check=list(HealthCheck))
@given(schema["/api/admin/audit"]["POST"].as_strategy(generation_mode=GenerationMode.NEGATIVE))
def negated_credentials_stay_negated(case):
    data = case.meta.phase.data
    negated = {mutation.parameter for mutation in data.mutations}
    shapes.add(frozenset(negated))
    cookies, headers = sent(case, case.cookies, case.headers)
    if "__Host-SESSION" in negated:
        assert cookies.get("__Host-SESSION") == (case.cookies or {}).get("__Host-SESSION"), \
            f"a negated session cookie is sent as generated, got {cookies}"
    else:
        assert cookies.get("__Host-SESSION") == "session-value", f"an untouched session cookie is supplied, got {cookies}"
    if "X-XSRF-TOKEN" in negated:
        assert headers.get("X-XSRF-TOKEN") == (case.headers or {}).get("X-XSRF-TOKEN"), \
            f"a negated CSRF header is sent as generated, got {headers.get('X-XSRF-TOKEN')}"
    else:
        assert headers.get("X-XSRF-TOKEN") == "csrf+cookie", "an untouched CSRF header is supplied"
    assert cookies.get("__Host-XSRF-TOKEN") == "csrf%2Bcookie", "the CSRF cookie is no security parameter and stays"


negated_credentials_stay_negated()
assert shapes >= {frozenset({"__Host-SESSION"}), frozenset({"X-XSRF-TOKEN"}),
                  frozenset({"__Host-SESSION", "X-XSRF-TOKEN"})}, \
    f"the generator negates each credential alone and both together, saw {shapes}"

coverage = CoveragePhaseData(scenario=CoverageScenario.MISSING_PARAMETER, description="", location=None,
                             parameter="__Host-SESSION", parameter_location=ParameterLocation.COOKIE, mutations=())
cookies, headers = sent(SimpleNamespace(meta=CaseMetadata(
    generation=GenerationInfo(time=0.0, mode=GenerationMode.NEGATIVE),
    components={ParameterLocation.COOKIE: ComponentInfo(mode=GenerationMode.NEGATIVE)},
    phase=PhaseInfo(name=TestPhase.COVERAGE, data=coverage))))
assert "__Host-SESSION" not in cookies, f"a coverage case missing the session cookie is sent without it, got {cookies}"
assert headers["X-XSRF-TOKEN"] == "csrf+cookie", "a coverage case that omits the cookie keeps the CSRF header"
