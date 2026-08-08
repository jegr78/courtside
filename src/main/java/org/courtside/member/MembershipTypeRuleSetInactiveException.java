package org.courtside.member;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class MembershipTypeRuleSetInactiveException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "rule-set-inactive", HttpStatus.BAD_REQUEST,
            "Rule set inactive", "The request references a rule set that is not active");

    MembershipTypeRuleSetInactiveException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
