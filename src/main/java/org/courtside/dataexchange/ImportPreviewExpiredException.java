package org.courtside.dataexchange;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class ImportPreviewExpiredException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-preview-expired", HttpStatus.CONFLICT,
            "Preview expired", "This preview is no longer kept and cannot be executed");

    ImportPreviewExpiredException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
