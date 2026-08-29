package org.courtside.config.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class InvalidClubLogoException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "invalid-club-logo", HttpStatus.BAD_REQUEST,
            "Invalid club logo", "The uploaded club logo is not usable");

    private final String code;

    InvalidClubLogoException(String code) {
        super("The uploaded club logo failed " + code);
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
