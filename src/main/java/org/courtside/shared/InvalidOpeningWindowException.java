package org.courtside.shared;

import lombok.Getter;
import org.springframework.http.HttpStatus;

import java.util.Map;

@Getter
public class InvalidOpeningWindowException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "invalid-opening-window", HttpStatus.BAD_REQUEST,
            "Invalid opening window", "The opening window is not usable");

    private final String code;

    InvalidOpeningWindowException(String code, String message) {
        super(message);
        this.code = code;
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }

    @Override
    protected Map<String, Object> properties() {
        return Map.of("code", code);
    }
}
