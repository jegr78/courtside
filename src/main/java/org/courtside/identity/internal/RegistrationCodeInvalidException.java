package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class RegistrationCodeInvalidException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "registration-code-invalid", HttpStatus.BAD_REQUEST,
            "Registration code invalid", "The registration code is unknown or was already used");

    RegistrationCodeInvalidException() {
        super("identity.registration.codeInvalid", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
