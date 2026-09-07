package org.courtside.identity.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

final class AccountSessionNotFoundException extends DomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "account-session-not-found", HttpStatus.NOT_FOUND,
            "Session not found", "No such active session");

    AccountSessionNotFoundException() {
        super("The requested account session does not exist");
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
