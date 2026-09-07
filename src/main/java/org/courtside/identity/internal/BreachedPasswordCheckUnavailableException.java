package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class BreachedPasswordCheckUnavailableException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "password-breach-check-unavailable", HttpStatus.SERVICE_UNAVAILABLE,
            "Password breach check unavailable",
            "A permanent password cannot be set until its breach check is available");

    BreachedPasswordCheckUnavailableException() {
        super("identity.password.breachCheckUnavailable", Map.of());
    }

    BreachedPasswordCheckUnavailableException(Throwable cause) {
        super("identity.password.breachCheckUnavailable", Map.of(), cause);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
