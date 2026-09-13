package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

// One type for a code nobody holds, one already redeemed and one whose account can no longer be
// reached: telling them apart would answer questions the request endpoint refuses to answer.
class ResetCodeInvalidException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "account-recovery-code-invalid", HttpStatus.BAD_REQUEST,
            "The code does not work",
            "This code is not one that can be redeemed");

    ResetCodeInvalidException() {
        super("identity.recovery.codeInvalid", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
