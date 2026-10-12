import json
from pathlib import Path
from types import SimpleNamespace

import requests

Path("/tmp/courtside-credentials.json").write_text(
    json.dumps({"session": "session-value", "csrfCookie": "csrf%2Bcookie", "csrfToken": "csrf+cookie"}),
    encoding="utf-8")

from schemathesis.core.mutations import Mutation, MutationChannel, OperatorKind
from schemathesis.core.parameters import ParameterLocation
from schemathesis.generation import GenerationMode
from schemathesis.generation.meta import (CaseMetadata, ComponentInfo, CoveragePhaseData, CoverageScenario,
                                         FuzzingPhaseData, GenerationInfo, PhaseInfo, TestPhase)

from schemathesis_credentials import before_call


def case(mode, parameter=None, location=None, mutations=(), coverage=False):
    if coverage:
        data = CoveragePhaseData(scenario=CoverageScenario.MISSING_PARAMETER, description="", location=None,
                                 parameter=parameter, parameter_location=location, mutations=tuple(mutations))
    else:
        data = FuzzingPhaseData(description=None, parameter=parameter, parameter_location=location, location=None,
                                mutations=tuple(mutations))
    meta = CaseMetadata(generation=GenerationInfo(time=0.0, mode=mode),
                        components={ParameterLocation.COOKIE: ComponentInfo(mode=mode)},
                        phase=PhaseInfo(name=TestPhase.COVERAGE if coverage else TestPhase.FUZZING, data=data))
    return SimpleNamespace(meta=meta)


def mutation(location, parameter):
    return Mutation(path=(), parameter_location=location, schema_pointer="", channel=MutationChannel.SCHEMA,
                    operator=OperatorKind.NEGATE_CONSTRAINTS, keywords=("required",), parameter=parameter,
                    original_value=None, new_value=None)


def sent(meta_case, cookie=None, header=None):
    kwargs = {}
    before_call(None, meta_case, kwargs)
    request = requests.Request("GET", "https://localhost/api/admin/audit",
                               headers={**({"Cookie": cookie} if cookie else {}), **(header or {})}).prepare()
    kwargs["auth"](request)
    cookies = dict(pair.split("=", 1) for pair in request.headers.get("Cookie", "").split("; ") if "=" in pair)
    return cookies, request.headers


cookies, headers = sent(case(GenerationMode.POSITIVE), header={"X-XSRF-TOKEN": "generated"})
assert cookies == {"__Host-SESSION": "session-value", "__Host-XSRF-TOKEN": "csrf%2Bcookie"}
assert headers["X-XSRF-TOKEN"] == "csrf+cookie"

cookies, headers = sent(case(GenerationMode.NEGATIVE, "__Host-SESSION", ParameterLocation.COOKIE),
                        cookie="__Host-SESSION=negated")
assert cookies == {"__Host-SESSION": "negated", "__Host-XSRF-TOKEN": "csrf%2Bcookie"}
assert headers["X-XSRF-TOKEN"] == "csrf+cookie"

cookies, headers = sent(case(GenerationMode.NEGATIVE, mutations=[mutation(ParameterLocation.COOKIE, "__Host-SESSION"),
                                                                 mutation(ParameterLocation.HEADER, "x-xsrf-token")]))
assert "__Host-SESSION" not in cookies
assert "X-XSRF-TOKEN" not in headers

cookies, headers = sent(case(GenerationMode.POSITIVE), cookie="probe=a=b", header={"x-xsrf-token": "generated"})
assert cookies == {"probe": "a=b", "__Host-SESSION": "session-value", "__Host-XSRF-TOKEN": "csrf%2Bcookie"}
assert headers["X-XSRF-TOKEN"] == "csrf+cookie" and list(headers).count("x-xsrf-token") == 0

cookies, headers = sent(case(GenerationMode.NEGATIVE, "__Host-SESSION", ParameterLocation.COOKIE, coverage=True))
assert "__Host-SESSION" not in cookies
assert headers["X-XSRF-TOKEN"] == "csrf+cookie"
