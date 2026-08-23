import json

from schemathesis.engine.recorder import CheckFailureInfo
from schemathesis.openapi.checks import JsonSchemaError, UndefinedContentType, UndefinedStatusCode
from schemathesis.reporting import ndjson


def projected(failure):
    return ndjson.serialize(CheckFailureInfo("curl with a credential", failure))["reason"]


schema_reason = projected(JsonSchemaError(
    operation="GET /api/admin/roster",
    validation_message="response contained an opaque identifier",
    schema_path=["properties", "items", "items", "required"],
    schema={"type": "object", "required": ["id", "email"]},
    instance_path=["items", 0],
    instance={"id": "opaque-object-id"},
    message="response contained a credential",
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

serialized = json.dumps([schema_reason, status_reason, media_reason])
assert "opaque-object-id" not in serialized
assert "credential" not in serialized
assert "session-secret" not in serialized
