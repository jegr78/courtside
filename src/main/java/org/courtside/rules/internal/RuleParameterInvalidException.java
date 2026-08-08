package org.courtside.rules.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class RuleParameterInvalidException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "rule-parameter-invalid", HttpStatus.BAD_REQUEST,
            "Invalid rule parameters", "The submitted rule parameters are not acceptable");

    RuleParameterInvalidException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
