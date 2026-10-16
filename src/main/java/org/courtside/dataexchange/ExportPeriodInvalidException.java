package org.courtside.dataexchange;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.time.LocalDate;
import java.util.Map;

public class ExportPeriodInvalidException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "export-period-invalid", HttpStatus.BAD_REQUEST,
            "Export period invalid", "The last day of the period comes before its first day");

    public ExportPeriodInvalidException(LocalDate from, LocalDate to) {
        super("export.period.endsBeforeItStarts", Map.of("from", from.toString(), "to", to.toString()));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
