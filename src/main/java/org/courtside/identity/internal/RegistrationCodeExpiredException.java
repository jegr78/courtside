package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class RegistrationCodeExpiredException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "registration-code-expired", HttpStatus.BAD_REQUEST,
            "Registration code expired", "The registration code has expired");

    RegistrationCodeExpiredException() {
        super("identity.registration.codeExpired", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
