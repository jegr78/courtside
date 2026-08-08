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

@Constraint(validatedBy = ChronologicalSeries.Validator.class)
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@interface ChronologicalSeries {

    String message() default "A series cannot end before it starts.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<ChronologicalSeries, SeriesRuleRequest> {

        @Override
        public boolean isValid(SeriesRuleRequest value, ConstraintValidatorContext context) {
            if (value == null || value.endsOn() == null || value.startsOn() == null
                    || !value.endsOn().isBefore(value.startsOn())) {
                return true;
            }
            return SeriesConstraints.reportOn(context, "endsOn");
        }
    }
}
