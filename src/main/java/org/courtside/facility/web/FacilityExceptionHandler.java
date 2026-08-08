package org.courtside.facility.web;

import org.courtside.facility.CourtNotFoundException;
import org.courtside.facility.internal.CourtNumberTakenException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;

// CourtNumberTakenException wraps the DataIntegrityViolationException the unique number constraint raised.
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
class FacilityExceptionHandler {

    @ExceptionHandler(CourtNotFoundException.class)
    ProblemDetail handleUnknownCourt(CourtNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.NOT_FOUND, "No such court");
        problem.setType(URI.create("urn:courtside:error:court-not-found"));
        problem.setTitle("Court not found");
        return problem;
    }

    @ExceptionHandler(CourtNumberTakenException.class)
    ProblemDetail handleNumberTaken(CourtNumberTakenException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.CONFLICT, "This court number is already in use");
        problem.setType(URI.create("urn:courtside:error:court-number-taken"));
        problem.setTitle("Court number taken");
        return problem;
    }
}
