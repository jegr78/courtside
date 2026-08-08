package org.courtside.shared.web;

import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SharedExceptionHandlerTest {

    // No known write path reaches this handler unclaimed, so it is pinned directly rather than
    // through a fabricated HTTP request that would misrepresent what the API can currently produce.
    @Test
    void whenHandlingAnUntranslatedConstraintViolation_thenTheProblemDetailNamesItsOwnType() {
        // given
        SharedExceptionHandler handler = new SharedExceptionHandler();

        // when
        ProblemDetail problem = handler.handleRejectedByTheDatabase(
                new DataIntegrityViolationException("some_constraint_nothing_recognises"));

        // then
        assertThat(problem.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST.value());
        assertThat(problem.getType().toString()).isEqualTo("urn:courtside:error:constraint-violation");
    }

    @Test
    @SuppressWarnings("unchecked")
    void givenAFieldErrorThatIsNotABeanValidationViolation_whenHandlingIt_thenAProblemDetailStillNamesTheField()
            throws NoSuchMethodException {
        // given — a type-mismatch binding failure on a @ModelAttribute/@RequestBody field carries
        // no ConstraintViolation to unwrap, unlike a rejected @NotBlank or @Pattern
        SharedExceptionHandler handler = new SharedExceptionHandler();
        MethodArgumentNotValidException exception = typeMismatchException();

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

    private MethodArgumentNotValidException typeMismatchException() throws NoSuchMethodException {
        Method dummy = getClass().getDeclaredMethod("dummy", String.class);
        MethodParameter parameter = new MethodParameter(dummy, 0);
        BeanPropertyBindingResult bindingResult = new BeanPropertyBindingResult(new Object(), "target");
        bindingResult.addError(new FieldError("target", "page", null, false, null, null,
                "Failed to convert value of type 'java.lang.String' to required type 'int'"));
        return new MethodArgumentNotValidException(parameter, bindingResult);
    }

    private void dummy(String page) {
    }
}
