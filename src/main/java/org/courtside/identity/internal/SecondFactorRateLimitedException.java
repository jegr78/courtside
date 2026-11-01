package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;

import java.util.Map;

class SecondFactorRateLimitedException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "second-factor-rate-limited", HttpStatus.TOO_MANY_REQUESTS,
            "Second-factor checks paused",
            "Too many failed second-factor proofs; try again later");

    private final long retryAfterSeconds;

    SecondFactorRateLimitedException(LoginBlock block) {
        this(Math.max(1, block.retryAfter().toSeconds()));
    }

    private SecondFactorRateLimitedException(long retryAfterSeconds) {
        super("identity.mfa.rateLimited", Map.of("minutes", (retryAfterSeconds + 59) / 60));
        this.retryAfterSeconds = retryAfterSeconds;
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
