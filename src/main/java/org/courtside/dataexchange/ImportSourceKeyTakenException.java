package org.courtside.dataexchange;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class ImportSourceKeyTakenException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-source-key-taken", HttpStatus.CONFLICT,
            "Import source key taken", "Another import source already uses this key");

    ImportSourceKeyTakenException(String message, Throwable cause) {
        super(message, cause);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
