package org.courtside.shared.web;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class SharedExceptionHandlerTest {

    // No known write path reaches this handler unclaimed, so it is pinned directly rather than
    // through a fabricated HTTP request that would misrepresent what the API can currently produce.
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
}
