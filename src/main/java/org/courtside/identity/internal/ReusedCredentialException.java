package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class ReusedCredentialException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "password-reuses-credential", HttpStatus.BAD_REQUEST,
            "Password repeats the issued credential",
            "The password is the one this instance sent the member to sign in with the first time");

    ReusedCredentialException() {
        super("identity.password.reusesCredential", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
