package org.courtside.booking.web;

import jakarta.validation.Validator;
import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiCreateBookingRequest;
import org.courtside.api.ApiParticipantRequest;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Component
@RequiredArgsConstructor
final class BookingValidationPreparation implements SmartInitializingSingleton {

    private final Validator validator;
    private final ObjectMapper mapper;

    @Override
    public void afterSingletonsInstantiated() {
        validator.getConstraintsForClass(BookingController.class);
        validator.getConstraintsForClass(ApiCreateBookingRequest.class);
        validator.getConstraintsForClass(ApiParticipantRequest.class);
        UUID identifier = new UUID(0, 0);
        var startsAt = Instant.EPOCH.atOffset(ZoneOffset.UTC);
        var request = new ApiCreateBookingRequest(Set.of(identifier), identifier, startsAt, startsAt.plusHours(1))
                .participants(List.of(new ApiParticipantRequest().personId(identifier)));
        var mapped = mapper.readValue(mapper.writeValueAsBytes(request), ApiCreateBookingRequest.class);
        if (!validator.validate(mapped).isEmpty()) {
            throw new IllegalStateException("Cannot prepare booking request validation");
        }
    }
}
