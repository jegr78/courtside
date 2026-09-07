package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class ReauthenticationFailedException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "reauthentication-failed", HttpStatus.FORBIDDEN,
            "Reauthentication failed", "The current authentication factors were not accepted");

    ReauthenticationFailedException() {
        super("identity.reauthentication.failed", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
