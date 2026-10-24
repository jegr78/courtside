import json

import jsonschema_rs

from schemathesis.core.failures import ContentTypeServerError
from schemathesis.engine.recorder import CheckFailureInfo
from schemathesis.openapi.checks import JsonSchemaError, UndefinedContentType, UndefinedStatusCode
from schemathesis.reporting import ndjson


def projected(failure):
    return ndjson.serialize(CheckFailureInfo("curl with a credential", failure))["reason"]


response_schema = {"type": "object", "properties": {"items": {"type": "array", "items": {
    "type": "object", "properties": {"id": {"type": "string"}, "email": {"type": "string"}},
    "required": ["id", "email"],
}}}}
validation_error = next(jsonschema_rs.Draft202012Validator(response_schema).iter_errors(
    {"items": [{"id": "opaque-object-id"}]}))
schema_reason = projected(JsonSchemaError.from_exception(
    operation="GET /api/admin/roster", exc=validation_error, root_schema=response_schema,
))
assert schema_reason == {
    "kind": "schema",
    "instancePointer": "/items/*",
    "validationKeyword": "required",
    "missingProperties": ["email"],
}

status_reason = projected(UndefinedStatusCode(
    operation="GET /api/admin/roster",
    status_code=404,
    defined_status_codes=["400"],
    allowed_status_codes=[400],
    message="response contained a credential",
))
assert status_reason == {"kind": "status", "observedStatus": 404, "expectedStatuses": [400]}

media_reason = projected(UndefinedContentType(
    operation="GET /api/admin/roster",
    content_type="application/session-secret; token=credential",
    defined_content_types=["application/json"],
    message="response contained a credential",
))
assert media_reason == {"kind": "media-type", "observed": "undocumented", "expected": ["application/json"]}

probe_reason = projected(ContentTypeServerError(
    operation="POST /api/admin/courts",
    status_code=500,
    message="response contained a credential",
))
assert probe_reason == {"kind": "status", "observedStatus": 500, "expectedStatuses": ["non-5xx"]}

serialized = json.dumps([schema_reason, status_reason, media_reason, probe_reason])
assert "opaque-object-id" not in serialized
assert "credential" not in serialized
assert "session-secret" not in serialized
