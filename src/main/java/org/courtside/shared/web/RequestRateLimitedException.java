package org.courtside.shared.web;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;

import java.time.Duration;
import java.util.Map;

class RequestRateLimitedException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "request-rate-limited", HttpStatus.TOO_MANY_REQUESTS,
            "Too many requests", "Too many requests from this client; try again later");

    private final long retryAfterSeconds;

    RequestRateLimitedException(Duration retryAfter) {
        super("admission.rateLimited", Map.of());
        this.retryAfterSeconds = Math.max(1, retryAfter.toSeconds() + (retryAfter.toNanosPart() == 0 ? 0 : 1));
    }

    @Override
    public HttpHeaders getHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.RETRY_AFTER, Long.toString(retryAfterSeconds));
        return headers;
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
