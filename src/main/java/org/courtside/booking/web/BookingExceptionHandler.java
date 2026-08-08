package org.courtside.booking.web;

import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.booking.internal.BookingNotOwnedException;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.internal.CardRoleRequiredException;
import org.courtside.booking.internal.CourtUnavailableException;
import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.booking.series.SeriesMoveConflictException;
import org.courtside.booking.series.SeriesNotFoundException;
import org.courtside.rules.RuleViolation;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;
import java.util.Map;

// CourtUnavailableException wraps the DataIntegrityViolationException the exclusion constraint raised.
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
class BookingExceptionHandler {

    @ExceptionHandler(BookingRulesViolatedException.class)
    ProblemDetail handleRuleViolations(BookingRulesViolatedException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.UNPROCESSABLE_ENTITY, "The booking violates one or more rules");
        problem.setType(URI.create("urn:courtside:error:booking-rules-violated"));
        problem.setTitle("Booking not allowed");
        problem.setProperty("violations", exception.getViolations().stream()
                .map(BookingExceptionHandler::toMap)
                .toList());
        return problem;
    }

    @ExceptionHandler(CourtUnavailableException.class)
    ProblemDetail handleCourtUnavailable(CourtUnavailableException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.CONFLICT, "This court was just booked by someone else");
        problem.setType(URI.create("urn:courtside:error:court-unavailable"));
        problem.setTitle("Court unavailable");
        return problem;
    }

    @ExceptionHandler(BookingNotOwnedException.class)
    ProblemDetail handleForeignBooking(BookingNotOwnedException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.FORBIDDEN, "You may only change your own bookings");
        problem.setType(URI.create("urn:courtside:error:booking-not-owned"));
        problem.setTitle("Not allowed");
        return problem;
    }

    @ExceptionHandler(CardRoleRequiredException.class)
    ProblemDetail handleMissingCardRole(CardRoleRequiredException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.FORBIDDEN, "Your roles do not allow this booking card");
        problem.setType(URI.create("urn:courtside:error:card-role-required"));
        problem.setTitle("Booking card not allowed");
        return problem;
    }

    @ExceptionHandler(ParticipantsInvalidException.class)
    ProblemDetail handleInvalidParticipants(ParticipantsInvalidException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "The participants of this booking are not acceptable");
        problem.setType(URI.create("urn:courtside:error:participants-invalid"));
        problem.setTitle("Invalid participants");
        problem.setProperty("code", exception.getCode());
        problem.setProperty("params", exception.getParams());
        return problem;
    }

    @ExceptionHandler(BookingNotFoundException.class)
    ProblemDetail handleUnknownBooking(BookingNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.NOT_FOUND, "No such booking");
        problem.setType(URI.create("urn:courtside:error:booking-not-found"));
        problem.setTitle("Booking not found");
        return problem;
    }

    @ExceptionHandler(SeriesNotFoundException.class)
    ProblemDetail handleUnknownSeries(SeriesNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.NOT_FOUND, "No such booking series");
        problem.setType(URI.create("urn:courtside:error:series-not-found"));
        problem.setTitle("Series not found");
        return problem;
    }

    @ExceptionHandler(SeriesMoveConflictException.class)
    ProblemDetail handleBlockedMove(SeriesMoveConflictException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.CONFLICT, "Some occurrences cannot move to the requested slot");
        problem.setType(URI.create("urn:courtside:error:series-move-conflict"));
        problem.setTitle("Move not possible");
        problem.setProperty("blockedBookingIds", exception.getBlockedBookingIds());
        problem.setProperty("code", "booking.series.moveConflict");
        return problem;
    }

    private static Map<String, Object> toMap(RuleViolation violation) {
        return Map.of("code", violation.code(), "params", violation.params());
    }
}
