package org.courtside.config.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiClubConfigRequest;
import org.courtside.config.BookingSlotDuration;
import org.courtside.shared.SupportedLanguages;
import org.springframework.stereotype.Component;
import org.springframework.validation.Errors;
import org.springframework.validation.Validator;
import java.time.DateTimeException;
import java.time.ZoneId;

@Component
@RequiredArgsConstructor
class ConfigRequestValidator implements Validator {

    private final SupportedLanguages languages;

    @Override
    public boolean supports(Class<?> type) {
        return ApiClubConfigRequest.class.isAssignableFrom(type);
    }

    @Override
    public void validate(Object target, Errors errors) {
        ApiClubConfigRequest request = (ApiClubConfigRequest) target;
        Integer slotMinutes = request.getSlotMinutes();
        if (slotMinutes != null && !BookingSlotDuration.isValid(slotMinutes)) {
            errors.rejectValue("slotMinutes", "MultipleOf");
        }
        String defaultLocale = request.getDefaultLocale();
        if (defaultLocale != null && !languages.supports(defaultLocale)) {
            errors.rejectValue("defaultLocale", "Language");
        }
        String timeZone = request.getTimeZone();
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
