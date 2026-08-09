package org.courtside.booking.web;

import org.courtside.booking.web.SeriesWebModels.MoveRequestBody;
import org.courtside.booking.web.SeriesWebModels.SeriesRuleRequest;
import org.springframework.stereotype.Component;
import org.springframework.validation.Errors;
import org.springframework.validation.Validator;

// See BookingRequestValidator for why these rules are not annotations on the request records.
@Component
class SeriesRequestValidator implements Validator {

    @Override
    public boolean supports(Class<?> type) {
        return SeriesRuleRequest.class.isAssignableFrom(type)
                || MoveRequestBody.class.isAssignableFrom(type);
    }

    @Override
    public void validate(Object target, Errors errors) {
        if (target instanceof SeriesRuleRequest rule) {
            validateRule(rule, errors);
        } else if (target instanceof MoveRequestBody move) {
            validateMove(move, errors);
        }
    }

    private void validateRule(SeriesRuleRequest rule, Errors errors) {
        if ((rule.endsOn() == null) == (rule.occurrenceCount() == null)) {
            errors.rejectValue("endsOn", "SeriesEndsOnce");
            return;
        }
        if (rule.endsOn() != null && rule.startsOn() != null && rule.endsOn().isBefore(rule.startsOn())) {
            errors.rejectValue("endsOn", "ChronologicalSeries");
        }
    }

    private void validateMove(MoveRequestBody move, Errors errors) {
        if (move.newStartTime() == null && move.newDurationMinutes() == null
                && move.newCourtIds() == null) {
            errors.rejectValue("newStartTime", "MoveChangesSomething");
        }
    }
}
