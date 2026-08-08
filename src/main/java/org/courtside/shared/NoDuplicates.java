package org.courtside.shared;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.util.List;
import java.util.Objects;

@Constraint(validatedBy = NoDuplicates.Validator.class)
@Target(ElementType.FIELD)
@Retention(RetentionPolicy.RUNTIME)
public @interface NoDuplicates {

    // A plain literal, not a "{key}" placeholder: Hibernate Validator resolves that form against
    // ValidationMessages.properties, not this project's own bundles, so it would never resolve.
    String message() default "Each entry may appear at most once.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<NoDuplicates, List<?>> {

        @Override
        public boolean isValid(List<?> value, ConstraintValidatorContext context) {
            if (value == null) {
                return true;
            }
            List<?> present = value.stream().filter(Objects::nonNull).toList();
            return present.stream().distinct().count() == present.size();
        }
    }
}
