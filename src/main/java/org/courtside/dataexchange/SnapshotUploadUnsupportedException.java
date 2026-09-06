package org.courtside.dataexchange;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class SnapshotUploadUnsupportedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-snapshot-upload-unsupported", HttpStatus.BAD_REQUEST,
            "Snapshot upload unsupported", "The upload is not a member list this instance reads");

    public SnapshotUploadUnsupportedException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
