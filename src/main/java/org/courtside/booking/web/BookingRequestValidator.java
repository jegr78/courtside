package org.courtside.booking.web;

import org.courtside.api.ApiCreateBookingRequest;
import org.springframework.stereotype.Component;
import org.springframework.validation.Errors;
import org.springframework.validation.Validator;

// Rules that span two fields, which no per-field constraint and no OpenAPI keyword can state.
// They live here rather than as an annotation on the request model because the model is generated
// from the API document: an annotation on it would be overwritten on the next build. Errors are
// reported against the field the member has to correct, so they reach the client as fieldErrors
// entries exactly as a Bean Validation failure does.
@Component
class BookingRequestValidator implements Validator {

    @Override
    public boolean supports(Class<?> type) {
        return ApiCreateBookingRequest.class.isAssignableFrom(type);
    }

    @Override
    public void validate(Object target, Errors errors) {
        ApiCreateBookingRequest request = (ApiCreateBookingRequest) target;
        if (request.getStartsAt() == null || request.getEndsAt() == null) {
            return;
        }
        if (!request.getEndsAt().isAfter(request.getStartsAt())) {
            errors.rejectValue("endsAt", "ChronologicalSlot");
        }
    }
}
