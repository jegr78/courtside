package org.courtside.dataexchange;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class RemovalsNeedConfirmationException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-removals-need-confirmation", HttpStatus.CONFLICT,
            "Removals need confirmation", "More memberships would end than this source allows without a deliberate confirmation");

    RemovalsNeedConfirmationException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
