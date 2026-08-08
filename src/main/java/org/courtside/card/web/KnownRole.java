package org.courtside.card.web;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import org.courtside.identity.Role;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Constraint(validatedBy = KnownRole.Validator.class)
@Target(ElementType.FIELD)
@Retention(RetentionPolicy.RUNTIME)
@interface KnownRole {

    // A plain literal, not a "{key}" placeholder: Hibernate Validator resolves that form against
    // ValidationMessages.properties, not this project's own bundles, so it would never resolve.
    String message() default "Not a role this instance knows.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<KnownRole, String> {

        @Override
        public boolean isValid(String value, ConstraintValidatorContext context) {
            return value == null || Role.named(value).isPresent();
        }
    }
}
