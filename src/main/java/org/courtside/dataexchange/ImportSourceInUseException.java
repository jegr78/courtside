package org.courtside.dataexchange;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class ImportSourceInUseException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-source-in-use", HttpStatus.CONFLICT,
            "Import source in use", "Records in the roster still name this source as where they came from");

    ImportSourceInUseException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
