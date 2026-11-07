package org.courtside.identity.internal;

import org.courtside.identity.OutsiderRefusedException;
import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;

import java.util.Map;

class AccountClosureNotOpenException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = OutsiderRefusedException.PROBLEM_TYPE;

    AccountClosureNotOpenException() {
        super("identity.account.closureNotOpen", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }

    @Override
    public boolean refusesAuthorization() {
        return true;
    }
}
