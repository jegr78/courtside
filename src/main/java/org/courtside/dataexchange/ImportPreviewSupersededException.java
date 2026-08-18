package org.courtside.dataexchange;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class ImportPreviewSupersededException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-preview-superseded", HttpStatus.CONFLICT,
            "Preview superseded", "A newer preview exists for this source, or this one has already been executed");

    ImportPreviewSupersededException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
