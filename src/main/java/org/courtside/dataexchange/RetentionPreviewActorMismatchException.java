package org.courtside.dataexchange;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class RetentionPreviewActorMismatchException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "retention-preview-actor-mismatch", HttpStatus.CONFLICT,
            "Retention preview belongs to another account", "The account that reviewed a retention preview is the only account that can run it");

    RetentionPreviewActorMismatchException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
