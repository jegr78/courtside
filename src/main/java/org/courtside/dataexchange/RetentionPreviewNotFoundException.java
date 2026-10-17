package org.courtside.dataexchange;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class RetentionPreviewNotFoundException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "retention-preview-not-found", HttpStatus.NOT_FOUND,
            "Retention preview not found", "No such retention preview, or it has already been run");

    RetentionPreviewNotFoundException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
