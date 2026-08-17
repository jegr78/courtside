package org.courtside.booking.web;

import org.courtside.api.ApiCreateBookingRequest;
import org.springframework.stereotype.Component;
import org.springframework.validation.Errors;
import org.springframework.validation.Validator;

// The request model is generated and loses an annotation on the next build.
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
