package org.courtside.booking.web;

import org.courtside.api.ApiCreateSeriesRequest;
import org.courtside.api.ApiMoveRequest;
import org.courtside.api.ApiSeriesRuleRequest;
import org.springframework.stereotype.Component;
import org.springframework.validation.Errors;
import org.springframework.validation.Validator;

import java.time.LocalDate;

// See BookingRequestValidator for why these rules are not annotations on the request models.
@Component
class SeriesRequestValidator implements Validator {

    @Override
    public boolean supports(Class<?> type) {
        return ApiSeriesRuleRequest.class.isAssignableFrom(type)
                || ApiCreateSeriesRequest.class.isAssignableFrom(type)
                || ApiMoveRequest.class.isAssignableFrom(type);
    }

    @Override
    public void validate(Object target, Errors errors) {
        // Previewing and creating carry the same recurrence in two generated types, so the same
        // two rules have to be stated against both.
        if (target instanceof ApiSeriesRuleRequest rule) {
            validateRule(rule.getStartsOn(), rule.getEndsOn(), rule.getOccurrenceCount(), errors);
        } else if (target instanceof ApiCreateSeriesRequest rule) {
            validateRule(rule.getStartsOn(), rule.getEndsOn(), rule.getOccurrenceCount(), errors);
        } else if (target instanceof ApiMoveRequest move) {
            validateMove(move, errors);
        }
    }

    private void validateRule(LocalDate startsOn, LocalDate endsOn, Integer occurrenceCount,
                              Errors errors) {
        if ((endsOn == null) == (occurrenceCount == null)) {
            errors.rejectValue("endsOn", "SeriesEndsOnce");
            return;
        }
        if (endsOn != null && startsOn != null && endsOn.isBefore(startsOn)) {
            errors.rejectValue("endsOn", "ChronologicalSeries");
        }
    }

    private void validateMove(ApiMoveRequest move, Errors errors) {
        if (move.getNewStartTime() == null && move.getNewDurationMinutes() == null
                && move.getNewCourtIds() == null) {
            errors.rejectValue("newStartTime", "MoveChangesSomething");
        }
    }
}
