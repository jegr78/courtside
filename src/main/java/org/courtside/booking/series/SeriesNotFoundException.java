package org.courtside.booking.series;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class SeriesNotFoundException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "series-not-found", HttpStatus.NOT_FOUND,
            "Series not found", "No such booking series");

    public SeriesNotFoundException(String message) {
        super(message);
    }


    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
