package org.courtside.card.web;

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

@Constraint(validatedBy = NoDuplicatePlayerCounts.Validator.class)
@Target(ElementType.FIELD)
@Retention(RetentionPolicy.RUNTIME)
@interface NoDuplicatePlayerCounts {

    // A plain literal, not a "{key}" placeholder: Hibernate Validator resolves that form against
    // ValidationMessages.properties, not this project's own bundles, so it would never resolve.
    String message() default "Each player count may appear at most once.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<NoDuplicatePlayerCounts, List<Integer>> {

        @Override
        public boolean isValid(List<Integer> value, ConstraintValidatorContext context) {
            if (value == null) {
                return true;
            }
            List<Integer> present = value.stream().filter(Objects::nonNull).toList();
            return present.stream().distinct().count() == present.size();
        }
    }
}
