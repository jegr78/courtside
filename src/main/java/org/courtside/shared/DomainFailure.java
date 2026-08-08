package org.courtside.shared;

import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.web.ErrorResponse;

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
}
