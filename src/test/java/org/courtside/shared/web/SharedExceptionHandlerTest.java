package org.courtside.shared.web;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotWritableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.ServletRequestBindingException;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class SharedExceptionHandlerTest {

    // No known write path reaches this handler unclaimed.
    @Test
    void whenHandlingAnUntranslatedConstraintViolation_thenTheProblemDetailNamesItsOwnType() {
        // given
        SharedExceptionHandler handler = new SharedExceptionHandler(mock(ProblemTraceReference.class));

        // when
        ProblemDetail problem = handler.handleRejectedByTheDatabase(
                new DataIntegrityViolationException("some_constraint_nothing_recognises"));

        // then
        assertThat(problem.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST.value());
        assertThat(problem.getType().toString()).isEqualTo("urn:courtside:error:constraint-violation");
    }

    @Test
    @SuppressWarnings("unchecked")
    void givenAFieldErrorThatIsNotABeanValidationViolation_whenHandlingIt_thenAProblemDetailStillNamesTheField() {
        // given
        SharedExceptionHandler handler = new SharedExceptionHandler(mock(ProblemTraceReference.class));
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
        SharedExceptionHandler handler = new SharedExceptionHandler(mock(ProblemTraceReference.class));

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
    }
}
