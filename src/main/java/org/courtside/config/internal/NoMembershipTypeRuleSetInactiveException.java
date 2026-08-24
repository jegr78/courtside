package org.courtside.config.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class NoMembershipTypeRuleSetInactiveException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "no-membership-type-rule-set-inactive", HttpStatus.BAD_REQUEST,
            "Rule set inactive",
            "The rule set for people without a membership type is not active");

    NoMembershipTypeRuleSetInactiveException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
