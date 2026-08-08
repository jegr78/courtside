package org.courtside.booking.web;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import org.courtside.booking.web.BookingWebModels.CreateBookingRequest;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Constraint(validatedBy = ChronologicalSlot.Validator.class)
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@interface ChronologicalSlot {

    String message() default "A booking must end after it starts.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    class Validator implements ConstraintValidator<ChronologicalSlot, CreateBookingRequest> {

        @Override
        public boolean isValid(CreateBookingRequest value, ConstraintValidatorContext context) {
            if (value == null || value.startsAt() == null || value.endsAt() == null) {
                return true;
            }
            if (value.endsAt().isAfter(value.startsAt())) {
                return true;
            }
            return FieldViolations.on(context, "endsAt");
        }
    }
}
