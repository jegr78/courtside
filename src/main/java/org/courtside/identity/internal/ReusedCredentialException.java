package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class ReusedCredentialException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "password-reuses-credential", HttpStatus.BAD_REQUEST,
            "Password repeats the current credential",
            "The password matches a credential the account already holds");

    ReusedCredentialException() {
        super("identity.password.reusesCredential", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
