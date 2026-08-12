package org.courtside.config.web;

import org.courtside.api.ApiClubConfigRequest;
import org.courtside.config.BookingSlotDuration;
import org.springframework.stereotype.Component;
import org.springframework.validation.Errors;
import org.springframework.validation.Validator;
import java.time.DateTimeException;
import java.time.ZoneId;

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
        String timeZone = ((ApiClubConfigRequest) target).getTimeZone();
        if (timeZone != null) {
            try {
                ZoneId.of(timeZone);
                if (!ZoneId.getAvailableZoneIds().contains(timeZone)) {
                    errors.rejectValue("timeZone", "TimeZone");
                }
            } catch (DateTimeException exception) {
                errors.rejectValue("timeZone", "TimeZone");
            }
        }
    }
}
