package org.courtside.identity;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AccountDeactivatedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "account-deactivated", HttpStatus.CONFLICT,
            "Account is deactivated",
            "A deactivated account cannot be reached, so nothing is issued for it");

    AccountDeactivatedException() {
        super("identity.account.deactivated", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
