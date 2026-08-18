package org.courtside.dataexchange;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class ImportPreviewStaleException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-preview-stale", HttpStatus.CONFLICT,
            "Preview stale", "Somebody this preview would change has changed since it was taken");

    ImportPreviewStaleException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
