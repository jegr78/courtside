package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class ResetCodeExpiredException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "account-recovery-code-expired", HttpStatus.BAD_REQUEST,
            "The code has expired",
            "This code was valid and is past its expiry; ask for another one");

    ResetCodeExpiredException() {
        super("identity.recovery.codeExpired", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
