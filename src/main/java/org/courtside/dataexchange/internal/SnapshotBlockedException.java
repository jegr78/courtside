package org.courtside.dataexchange.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class SnapshotBlockedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "import-snapshot-blocked", HttpStatus.BAD_REQUEST,
            "Snapshot blocked", "The file cannot be resolved against this source's configuration");

    SnapshotBlockedException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
