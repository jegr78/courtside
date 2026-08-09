package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class LoginRateLimitedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "login-rate-limited", HttpStatus.TOO_MANY_REQUESTS,
            "Too many login attempts", "Too many login attempts; try again later");

    LoginRateLimitedException() {
        super("identity.login.rateLimited", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
