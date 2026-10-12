package org.courtside.booking.web;

import org.courtside.api.ApiJoinWaitlistRequest;
import org.springframework.stereotype.Component;
import org.springframework.validation.Errors;
import org.springframework.validation.Validator;

@Component
class WaitlistRequestValidator implements Validator {

    @Override
    public boolean supports(Class<?> type) {
        return ApiJoinWaitlistRequest.class.isAssignableFrom(type);
    }

    @Override
    public void validate(Object target, Errors errors) {
        ApiJoinWaitlistRequest request = (ApiJoinWaitlistRequest) target;
        if (request.getStartsAt() == null || request.getEndsAt() == null) {
            return;
        }
        if (!request.getEndsAt().isAfter(request.getStartsAt())) {
            errors.rejectValue("endsAt", "ChronologicalSlot");
        }
    }
}
