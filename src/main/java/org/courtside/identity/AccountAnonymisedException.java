package org.courtside.identity;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AccountAnonymisedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "account-anonymised", HttpStatus.CONFLICT,
            "Account anonymised", "This account was closed and names nobody any more");

    public AccountAnonymisedException() {
        super("identity.account.anonymised", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
