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


def _status_class(value):
    if not isinstance(value, int) or value < 100 or value > 599:
        raise ValueError("unsupported HTTP status")
    return f"{value // 100}xx"


def _expected_status_classes(values):
    classes = []
    for value in values:
        if isinstance(value, int):
            candidate = _status_class(value)
        elif isinstance(value, str) and re.fullmatch(r"[1-5]XX", value.upper()):
            candidate = value[0] + "xx"
        elif isinstance(value, str) and value.isdigit():
            candidate = _status_class(int(value))
        else:
            raise ValueError("unsupported expected HTTP status")
        if candidate not in classes:
            classes.append(candidate)
    if not classes or len(classes) > 6:
        raise ValueError("unsupported expected HTTP status set")
    return classes


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
    return {"kind": "schema", "instancePointer": _pointer(instance_path),
            "schemaPointer": _pointer(schema_path), "validationKeyword": keyword}


def _reason(failure):
    name = type(failure).__name__
    if name == "ServerError":
        return {"kind": "status", "observedClass": _status_class(failure.status_code),
                "expectedClasses": ["non-5xx"]}
    if name == "UndefinedStatusCode":
        return {"kind": "status", "observedClass": _status_class(failure.status_code),
                "expectedClasses": _expected_status_classes(failure.allowed_status_codes)}
    if name == "AcceptedNegativeData":
        return {"kind": "status", "observedClass": _status_class(failure.status_code),
                "expectedClasses": _expected_status_classes(failure.expected_statuses)}
    if name == "RejectedPositiveData":
        return {"kind": "status", "observedClass": _status_class(failure.status_code),
                "expectedClasses": _expected_status_classes(failure.allowed_statuses)}
    if name == "MissingContentType":
        return {"kind": "media-type", "observed": "missing",
                "expected": _expected_media_types(failure.media_types)}
    if name == "UndefinedContentType":
        return {"kind": "media-type", "observed": _normalized_media_type(failure.content_type),
                "expected": _expected_media_types(failure.defined_content_types)}
    if name == "MalformedMediaType":
        return {"kind": "media-type", "observed": "malformed",
                "expected": _expected_media_types([failure.defined])}
    if name == "JsonSchemaError":
        return _schema_reason(failure)
    if name == "MalformedJson":
        return {"kind": "schema", "instancePointer": "", "schemaPointer": "",
                "validationKeyword": "json-syntax"}
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
