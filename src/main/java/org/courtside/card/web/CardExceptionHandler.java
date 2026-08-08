package org.courtside.card.web;

import org.courtside.card.internal.CardLabelTakenException;
import org.courtside.card.CardNotFoundException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;

// CardLabelTakenException wraps the DataIntegrityViolationException the unique label constraint raised.
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
class CardExceptionHandler {

    @ExceptionHandler(CardNotFoundException.class)
    ProblemDetail handleUnknownCard(CardNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.NOT_FOUND, "No such card");
        problem.setType(URI.create("urn:courtside:error:card-not-found"));
        problem.setTitle("Card not found");
        return problem;
    }

    @ExceptionHandler(CardLabelTakenException.class)
    ProblemDetail handleLabelTaken(CardLabelTakenException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.CONFLICT, "This card label is already in use");
        problem.setType(URI.create("urn:courtside:error:card-label-taken"));
        problem.setTitle("Label already in use");
        return problem;
    }
}
