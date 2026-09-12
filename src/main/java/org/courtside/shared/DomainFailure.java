package org.courtside.shared;

import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.web.ErrorResponse;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public abstract class DomainFailure extends RuntimeException implements ErrorResponse {

    protected DomainFailure(String message) {
        super(message);
    }

    protected DomainFailure(String message, Throwable cause) {
        super(message, cause);
    }

    public abstract ProblemType problemType();

    @Override
    public HttpStatusCode getStatusCode() {
        return problemType().status();
    }

    @Override
    public ProblemDetail getBody() {
        ProblemType type = problemType();
        ProblemDetail body = ProblemDetail.forStatusAndDetail(type.status(), type.detail());
        body.setType(type.uri());
        body.setTitle(type.title());
        properties().forEach(body::setProperty);
        return body;
    }

    protected Map<String, Object> properties() {
        return Map.of();
    }

    // Always an array, even for a single entry.
    protected static List<Map<String, Object>> oneViolation(String code, Map<String, Object> params) {
        return List.of(violation(code, params));
    }

    protected static Map<String, Object> violation(String code, Map<String, Object> params) {
        return Map.of("code", code, "params", params == null ? Map.of() : params);
    }

    // The i18n keys alone. A violation's params are built from what the request submitted, so a
    // caller that wants to say which rule refused must not be handed the values it refused over.
    public List<String> violationCodes() {
        if (!(properties().get("violations") instanceof Collection<?> collected)) {
            return List.of();
        }
        return collected.stream()
                .map(entry -> entry instanceof Map<?, ?> violation ? violation.get("code") : null)
                .filter(Objects::nonNull)
                .map(Object::toString)
                .toList();
    }
}
