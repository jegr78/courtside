package org.courtside.member;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class MembershipTypeRuleSetInvalidException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "rule-set-unresolvable", HttpStatus.BAD_REQUEST,
            "Rule set unresolvable", "The request references a rule set that does not exist");

    MembershipTypeRuleSetInvalidException(String code, Map<String, Object> params, Throwable cause) {
        super(code, params, cause);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
