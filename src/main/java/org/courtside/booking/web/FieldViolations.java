package org.courtside.booking.web;

import jakarta.validation.ConstraintValidatorContext;

// A class-level constraint's violation is a global error by default, and the response's
// fieldErrors array has no place for one. Naming a property turns it into an entry a client can
// put next to the input the member has to correct.
final class FieldViolations {

    private FieldViolations() {
    }

    static boolean on(ConstraintValidatorContext context, String property) {
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(context.getDefaultConstraintMessageTemplate())
                .addPropertyNode(property)
                .addConstraintViolation();
        return false;
    }
}
