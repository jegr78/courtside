package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class MfaResourceNotFoundException extends CodedDomainFailure {
    static final ProblemType PROBLEM_TYPE = new ProblemType("mfa-resource-not-found", HttpStatus.NOT_FOUND,
            "MFA resource not found", "The account or its credential is unavailable");

    MfaResourceNotFoundException() {
        super("identity.mfa.notFound", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
