package org.courtside.dataexchange;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class RetentionPreviewExpiredException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "retention-preview-expired", HttpStatus.CONFLICT,
            "Retention preview expired", "This retention preview is no longer kept and cannot be run; create a new one");

    RetentionPreviewExpiredException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
