import json
from pathlib import Path

import schemathesis
from requests.auth import AuthBase

_CREDENTIALS = json.loads(Path("/tmp/courtside-credentials.json").read_text(encoding="utf-8"))
_SUPPLIED = (("cookie", "__Host-SESSION", "session"),
             ("cookie", "__Host-XSRF-TOKEN", "csrfCookie"),
             ("header", "X-XSRF-TOKEN", "csrfToken"))


def _key(location, name):
    location = getattr(location, "value", location)
    return location, name.lower() if location == "header" and name else name


def _negated(case):
    meta = case.meta
    if meta is None or not meta.generation.mode.is_negative:
        return set()
    data = meta.phase.data
    targets = [(getattr(data, "parameter_location", None), getattr(data, "parameter", None))]
    targets += [(mutation.parameter_location, mutation.parameter) for mutation in getattr(data, "mutations", ())]
    return {_key(location, name) for location, name in targets if location and name}


class _Credentials(AuthBase):

    def __init__(self, negated):
        self.supplied = [(location, name, _CREDENTIALS[credential]) for location, name, credential in _SUPPLIED
                         if _key(location, name) not in negated]

    def __call__(self, request):
        for location, name, value in self.supplied:
            if location == "cookie":
                pairs = [pair for pair in request.headers.get("Cookie", "").split("; ")
                         if pair and pair.split("=", 1)[0] != name]
                request.headers["Cookie"] = "; ".join([*pairs, f"{name}={value}"])
            else:
                request.headers[name] = value
        return request


@schemathesis.hook
def before_call(context, case, kwargs):
    kwargs["auth"] = _Credentials(_negated(case))
