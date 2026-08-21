package org.courtside.dataexchange;

import org.courtside.dataexchange.internal.ReportedValue;
import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class SnapshotEncodingUnsupportedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "snapshot-encoding-unsupported", HttpStatus.BAD_REQUEST,
            "Encoding not supported",
            "This instance cannot read a file in that character set");

    SnapshotEncodingUnsupportedException(String name) {
        super("import.snapshot.encodingUnsupported", Map.of("encoding", ReportedValue.printable(name)));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
