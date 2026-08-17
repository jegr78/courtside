package org.courtside.dataexchange.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class SnapshotHeaderInvalidException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-snapshot-unreadable", HttpStatus.BAD_REQUEST,
            "Snapshot unreadable", "The uploaded file cannot be read as this source's export");

    SnapshotHeaderInvalidException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
