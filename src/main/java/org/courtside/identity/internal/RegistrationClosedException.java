package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class RegistrationClosedException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "registration-closed", HttpStatus.NOT_FOUND,
            "Registration closed", "This club does not take registrations");

    RegistrationClosedException() {
        super("identity.registration.closed", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
