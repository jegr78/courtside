package org.courtside.shared;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.util.Collection;

// @NotEmpty rejects null, and @Size(min = 1) reports a max of Integer.MAX_VALUE that no message
// can say anything sensible about. This is for the field that is optional — absent means "leave
// it as it is" — but must carry something once it is given at all.
@Constraint(validatedBy = NotEmptyIfGiven.Validator.class)
@Target(ElementType.FIELD)
@Retention(RetentionPolicy.RUNTIME)
public @interface NotEmptyIfGiven {

    // A plain literal, not a "{key}" placeholder: Hibernate Validator resolves that form against
    // ValidationMessages.properties, not this project's own bundles, so it would never resolve.
    String message() default "This field may be left out, but not left empty.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<NotEmptyIfGiven, Collection<?>> {

        @Override
        public boolean isValid(Collection<?> value, ConstraintValidatorContext context) {
            return value == null || !value.isEmpty();
        }
    }
}
