package org.courtside.booking.web;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import org.courtside.booking.web.SeriesWebModels.SeriesRuleRequest;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Constraint(validatedBy = SeriesEndsOnce.Validator.class)
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@interface SeriesEndsOnce {

    String message() default "A series ends either on a date or after a number of occurrences.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<SeriesEndsOnce, SeriesRuleRequest> {

        @Override
        public boolean isValid(SeriesRuleRequest value, ConstraintValidatorContext context) {
            if (value == null || (value.endsOn() == null) != (value.occurrenceCount() == null)) {
                return true;
            }
            return SeriesConstraints.reportOn(context, "endsOn");
        }
    }
}
