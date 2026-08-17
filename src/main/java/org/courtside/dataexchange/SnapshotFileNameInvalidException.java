package org.courtside.dataexchange;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class SnapshotFileNameInvalidException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-snapshot-file-name-invalid", HttpStatus.BAD_REQUEST,
            "Snapshot file name invalid", "The upload does not name the file it carries");

    SnapshotFileNameInvalidException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
