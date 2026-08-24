package org.courtside.config.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class NoMembershipTypeRuleSetInvalidException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "no-membership-type-rule-set-unresolvable", HttpStatus.BAD_REQUEST,
            "Rule set unresolvable",
            "The rule set for people without a membership type names nothing this club has");

    NoMembershipTypeRuleSetInvalidException(String code, Map<String, Object> params, Throwable cause) {
        super(code, params, cause);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
