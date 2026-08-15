package org.courtside.shared.web;

import org.springframework.core.MethodParameter;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;

final class FieldRejections {

    private FieldRejections() {
    }

    static MethodArgumentNotValidException rejectionOf(String field, Object rejectedValue, String... codes) {
        BindingResult binding = new BeanPropertyBindingResult(new Object(), "request");
        binding.addError(new FieldError("request", field, rejectedValue, false,
                codes.length == 0 ? null : codes, null, "the submitted value was rejected"));
        return new MethodArgumentNotValidException(handlerParameter(), binding);
    }

    private static MethodParameter handlerParameter() {
        try {
            return new MethodParameter(
                    FieldRejections.class.getDeclaredMethod("handle", String.class), 0);
        } catch (NoSuchMethodException e) {
            throw new IllegalStateException("This class declares the method it looks up", e);
        }
    }

    private static void handle(String value) {
    }
}
