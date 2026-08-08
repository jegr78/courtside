package org.courtside.shared;

import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.web.ErrorResponse;

import java.util.List;
import java.util.Map;

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

    // Every translatable failure travels as a violations array, including the ones that only ever
    // carry one. A client then has a single shape to render against the message bundle instead of
    // one path for the array and another for a top-level code.
    protected static List<Map<String, Object>> oneViolation(String code, Map<String, Object> params) {
        return List.of(Map.of("code", code, "params", params == null ? Map.of() : params));
    }
}
