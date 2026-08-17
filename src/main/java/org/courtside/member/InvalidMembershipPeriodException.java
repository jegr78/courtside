package org.courtside.member;

import lombok.Getter;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

@Getter
public class InvalidMembershipPeriodException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "invalid-membership-period", HttpStatus.BAD_REQUEST,
            "Invalid membership period", "The membership period is not usable");

    private final String code;

    InvalidMembershipPeriodException(String code, String message) {
        super(message);
        this.code = code;
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }

    @Override
    protected Map<String, Object> properties() {
        return Map.of("violations", oneViolation(code, Map.of()));
    }
}
