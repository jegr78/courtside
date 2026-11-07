package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;

import java.util.Map;

class RegistrationRateLimitedException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "registration-rate-limited", HttpStatus.TOO_MANY_REQUESTS,
            "Too many registrations",
            "Too many registrations from this address; try again later");

    private final long retryAfterSeconds;

    RegistrationRateLimitedException(LoginBlock block) {
        super("identity.registration.rateLimited", Map.of());
        this.retryAfterSeconds = Math.max(1, block.retryAfter().toSeconds());
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
