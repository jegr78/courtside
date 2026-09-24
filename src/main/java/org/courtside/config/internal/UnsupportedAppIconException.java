package org.courtside.config.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class UnsupportedAppIconException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "app-icon-unsupported", HttpStatus.BAD_REQUEST,
            "Unsupported app icon", "The app icon is not offered in this form");

    private final String parameter;

    UnsupportedAppIconException(String parameter) {
        super("The app icon is not offered for this " + parameter);
        this.parameter = parameter;
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }

    @Override
    protected Map<String, Object> properties() {
        return Map.of("violations", oneViolation("config.icon.unsupported", Map.of("parameter", parameter)));
    }
}
