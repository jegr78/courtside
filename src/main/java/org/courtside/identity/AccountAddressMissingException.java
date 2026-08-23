package org.courtside.identity;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AccountAddressMissingException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "account-address-missing", HttpStatus.CONFLICT,
            "Account has no address",
            "Credentials travel by mail, so an account with no address cannot be sent any");

    AccountAddressMissingException() {
        super("identity.account.addressMissing", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
