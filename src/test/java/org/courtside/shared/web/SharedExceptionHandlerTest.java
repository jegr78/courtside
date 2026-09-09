package org.courtside.shared.web;

import org.courtside.shared.SecurityEventLog;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotWritableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.ServletRequestBindingException;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class SharedExceptionHandlerTest {

    @Test
    void whenPostgresRefusesAContendedLock_thenTheProblemIsAnActionableTemporaryFailure() {
        // given
        SharedExceptionHandler handler = handler();

        // when
        ProblemDetail problem = handler.handleUncategorizedDatabaseFailure(
                new UncategorizedSQLException("query", "select for update",
                        new SQLException("lock timeout", "55P03")));

        // then
        assertThat(problem.getStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE.value());
        assertThat(problem.getType().toString()).isEqualTo("urn:courtside:error:database-lock-unavailable");
        assertThat(problem.getProperties()).containsEntry("retryable", true);
    }

    @Test
    void whenAnUncategorisedDatabaseFailureIsNotLockContention_thenItRemainsAnInternalFailure() {
        // given
        SharedExceptionHandler handler = handler();
        UncategorizedSQLException failure = new UncategorizedSQLException(
                "query", "select something", new SQLException("broken", "XX000"));

        // when
        ProblemDetail problem = handler.handleUncategorizedDatabaseFailure(failure);

        // then
        assertThat(problem.getStatus()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR.value());
        assertThat(problem.getType().toString()).isEqualTo("urn:courtside:error:internal-error");
        assertThat(problem.getTitle()).isEqualTo("Internal error");
        assertThat(problem.getDetail()).isEqualTo("This request could not be completed");
        assertThat(problem.toString()).doesNotContain("select something", "broken", "XX000");
    }

    // No known write path reaches this handler unclaimed.
    @Test
    void whenHandlingAnUntranslatedConstraintViolation_thenTheProblemDetailNamesItsOwnType() {
        // given
        SecurityEventLog securityEvents = mock(SecurityEventLog.class);
        SharedExceptionHandler handler = new SharedExceptionHandler(
                mock(ProblemTraceReference.class), securityEvents);

        // when
        ProblemDetail problem = handler.handleRejectedByTheDatabase(
                new DataIntegrityViolationException("some_constraint_nothing_recognises"));

        // then
        assertThat(problem.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST.value());
        assertThat(problem.getType().toString()).isEqualTo("urn:courtside:error:constraint-violation");
        verify(securityEvents).controlRefusedForCurrentAccount(
                SecurityEventLog.ControlRefusal.REQUEST_VALIDATION);
    }

    @Test
    @SuppressWarnings("unchecked")
    void givenAFieldErrorThatIsNotABeanValidationViolation_whenHandlingIt_thenAProblemDetailStillNamesTheField() {
        // given
        SharedExceptionHandler handler = handler();
        MethodArgumentNotValidException exception = FieldRejections.rejectionOf("page", null);

        // when
        ProblemDetail problem = handler.handleValidationFailure(exception);

        // then
        List<Map<String, Object>> fieldErrors =
                (List<Map<String, Object>>) problem.getProperties().get("fieldErrors");
        assertThat(fieldErrors).hasSize(1);
        assertThat(fieldErrors.getFirst())
                .containsEntry("field", "page")
                .containsEntry("code", "validation.rejected");
    }

    @Test
    void givenARejectionSpringRaisesInsideTheDispatcher_whenAnsweringIt_thenItCarriesTheStatusAndAType() {
        // given
        SecurityEventLog securityEvents = mock(SecurityEventLog.class);
        SharedExceptionHandler handler = new SharedExceptionHandler(
                mock(ProblemTraceReference.class), securityEvents);

        // when
        ResponseEntity<ProblemDetail> refused = handler.handleFrameworkRejection(
                new ServletRequestBindingException("a required header is missing"));
        ResponseEntity<ProblemDetail> unwritable = handler.handleFrameworkRejection(
                new HttpMessageNotWritableException("the answer cannot be serialised"));

        // then
        assertThat(refused.getStatusCode().value()).isEqualTo(HttpStatus.BAD_REQUEST.value());
        assertThat(refused.getBody().getType().toString())
                .isEqualTo("urn:courtside:error:request-rejected");
        assertThat(unwritable.getStatusCode().value())
                .isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR.value());
        assertThat(unwritable.getBody().getType().toString())
                .isEqualTo("urn:courtside:error:internal-error");
        verify(securityEvents).controlRefusedForCurrentAccount(
                SecurityEventLog.ControlRefusal.REQUEST_VALIDATION);
    }

    private static SharedExceptionHandler handler() {
        return new SharedExceptionHandler(mock(ProblemTraceReference.class),
                mock(org.courtside.shared.SecurityEventLog.class));
    }
}
