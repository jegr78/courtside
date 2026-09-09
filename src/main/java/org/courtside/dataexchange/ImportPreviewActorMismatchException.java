package org.courtside.dataexchange;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class ImportPreviewActorMismatchException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-preview-actor-mismatch", HttpStatus.CONFLICT,
            "Preview belongs to another account",
            "The account that reviewed an import preview is the only account that can execute it");

    ImportPreviewActorMismatchException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
