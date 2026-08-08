package org.courtside.booking.web;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import org.courtside.booking.web.SeriesWebModels.MoveRequestBody;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Constraint(validatedBy = MoveChangesSomething.Validator.class)
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@interface MoveChangesSomething {

    String message() default "A move must change the time, the duration or the courts.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<MoveChangesSomething, MoveRequestBody> {

        @Override
        public boolean isValid(MoveRequestBody value, ConstraintValidatorContext context) {
            if (value == null || value.newStartTime() != null || value.newDurationMinutes() != null
                    || value.newCourtIds() != null) {
                return true;
            }
            return FieldViolations.on(context, "newStartTime");
        }
    }
}
