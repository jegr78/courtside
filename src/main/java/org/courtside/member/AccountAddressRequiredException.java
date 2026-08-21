package org.courtside.member;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AccountAddressRequiredException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "account-needs-address", HttpStatus.BAD_REQUEST,
            "Account needs an address",
            "An account can only be reached by mail, so it cannot exist without one");

    AccountAddressRequiredException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
