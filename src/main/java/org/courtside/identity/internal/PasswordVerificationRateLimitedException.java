package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class PasswordVerificationRateLimitedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "password-verification-rate-limited", HttpStatus.TOO_MANY_REQUESTS,
            "Too many password verification attempts",
            "Too many password verification attempts; try again later");

    PasswordVerificationRateLimitedException() {
        super("identity.passwordVerification.rateLimited", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
