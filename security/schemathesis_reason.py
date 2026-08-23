import re

from schemathesis.engine.recorder import CheckFailureInfo
from schemathesis.reporting import ndjson


_serialize = ndjson.serialize
_media_type = re.compile(r"^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$")
_validation_keywords = {"additionalProperties", "allOf", "anyOf", "const", "contains", "dependentRequired",
                        "enum", "exclusiveMaximum", "exclusiveMinimum", "format", "json-syntax", "maxContains",
                        "maximum", "maxItems", "maxLength", "maxProperties", "minContains", "minimum", "minItems",
                        "minLength", "minProperties", "multipleOf", "not", "oneOf", "pattern", "propertyNames",
                        "required", "schema", "type", "unevaluatedProperties", "uniqueItems"}


def _status(value):
    if not isinstance(value, int) or value < 100 or value > 599:
        raise ValueError("unsupported HTTP status")
    return value


def _expected_statuses(values):
    statuses = []
    for value in values:
        if isinstance(value, int):
            candidate = _status(value)
        elif isinstance(value, str) and re.fullmatch(r"[1-5]XX", value.upper()):
            candidate = value[0] + "xx"
        elif isinstance(value, str) and value.isdigit():
            candidate = _status(int(value))
        else:
            raise ValueError("unsupported expected HTTP status")
        if candidate not in statuses:
            statuses.append(candidate)
    if not statuses or len(statuses) > 20:
        raise ValueError("unsupported expected HTTP status set")
    return statuses


def _normalized_media_type(value):
    if not isinstance(value, str):
        raise ValueError("unsupported media type")
    candidate = value.split(";", 1)[0].strip().lower()
    if len(candidate) > 100 or not _media_type.fullmatch(candidate):
        raise ValueError("unsupported media type")
    return candidate


def _expected_media_types(values):
    media_types = []
    for value in values:
        candidate = _normalized_media_type(value)
        if candidate not in media_types:
            media_types.append(candidate)
    if not media_types or len(media_types) > 20:
        raise ValueError("unsupported expected media type set")
    return media_types


def _pointer(segments):
    return "".join("/" + str(segment).replace("~", "~0").replace("/", "~1") for segment in segments)


def _schema_reason(failure):
    schema_path = list(failure.schema_path)
    public_properties = {schema_path[index + 1] for index, value in enumerate(schema_path[:-1])
                         if value == "properties" and isinstance(schema_path[index + 1], str)}
    instance_path = ["*" if isinstance(value, int) else value for value in failure.instance_path
                     if isinstance(value, int) or value in public_properties]
    keyword = schema_path[-1] if schema_path else "schema"
    if keyword not in _validation_keywords:
        raise ValueError("unsupported validation keyword")
    missing_properties = []
    if keyword == "required" and isinstance(failure.schema, dict) and isinstance(failure.instance, dict):
        required = failure.schema.get("required", [])
        if not isinstance(required, list) or not all(isinstance(value, str) for value in required):
            raise ValueError("unsupported required-property schema")
        missing_properties = sorted(value for value in required if value not in failure.instance)
        if not missing_properties:
            raise ValueError("required-property failure has no structural disagreement")
    return {"kind": "schema", "instancePointer": _pointer(instance_path),
            "validationKeyword": keyword, "missingProperties": missing_properties}


def _reason(failure):
    name = type(failure).__name__
    if name == "ServerError":
        return {"kind": "status", "observedStatus": _status(failure.status_code),
                "expectedStatuses": ["non-5xx"]}
    if name == "UndefinedStatusCode":
        return {"kind": "status", "observedStatus": _status(failure.status_code),
                "expectedStatuses": _expected_statuses(failure.allowed_status_codes)}
    if name == "AcceptedNegativeData":
        return {"kind": "status", "observedStatus": _status(failure.status_code),
                "expectedStatuses": _expected_statuses(failure.expected_statuses)}
    if name == "RejectedPositiveData":
        return {"kind": "status", "observedStatus": _status(failure.status_code),
                "expectedStatuses": _expected_statuses(failure.allowed_statuses)}
    if name == "MissingContentType":
        return {"kind": "media-type", "observed": "missing",
                "expected": _expected_media_types(failure.media_types)}
    if name == "UndefinedContentType":
        _normalized_media_type(failure.content_type)
        return {"kind": "media-type", "observed": "undocumented",
                "expected": _expected_media_types(failure.defined_content_types)}
    if name == "MalformedMediaType":
        return {"kind": "media-type", "observed": "malformed",
                "expected": _expected_media_types([failure.defined])}
    if name == "JsonSchemaError":
        return _schema_reason(failure)
    if name == "MalformedJson":
        return {"kind": "schema", "instancePointer": "", "validationKeyword": "json-syntax",
                "missingProperties": []}
    protocol = {
        "MissingHeaders": "missing-required-header",
        "MissingHeaderNotRejected": "missing-required-header",
        "UnsupportedMethodResponse": "unsupported-method-status",
        "AllowHeaderMismatch": "allow-header-mismatch",
    }
    disagreement = protocol.get(name)
    if disagreement is None:
        raise ValueError(f"unsupported Schemathesis failure type: {name}")
    if name == "UnsupportedMethodResponse" and getattr(failure, "failure_reason", None) == "missing_allow_header":
        disagreement = "missing-allow-header"
    return {"kind": "protocol", "disagreement": disagreement}


def serialize(value, *, sanitization=None):
    if isinstance(value, CheckFailureInfo):
        try:
            return {"reason": _reason(value.failure)}
        except (AttributeError, TypeError, ValueError):
            return {"reason": {"kind": "unsupported"}}
    return _serialize(value, sanitization=sanitization)


ndjson.serialize = serialize
