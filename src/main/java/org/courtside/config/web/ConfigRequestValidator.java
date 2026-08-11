package org.courtside.config.web;

import org.courtside.api.ApiClubConfigRequest;
import org.courtside.config.BookingSlotDuration;
import org.springframework.stereotype.Component;
import org.springframework.validation.Errors;
import org.springframework.validation.Validator;

@Component
class ConfigRequestValidator implements Validator {

    @Override
    public boolean supports(Class<?> type) {
        return ApiClubConfigRequest.class.isAssignableFrom(type);
    }

    @Override
    public void validate(Object target, Errors errors) {
        Integer slotMinutes = ((ApiClubConfigRequest) target).getSlotMinutes();
        if (slotMinutes != null && !BookingSlotDuration.isValid(slotMinutes)) {
            errors.rejectValue("slotMinutes", "MultipleOf");
        }
    }
}
