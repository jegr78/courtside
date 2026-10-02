package org.courtside.booking.web;

import jakarta.validation.Validator;
import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiCreateBookingRequest;
import org.courtside.api.ApiParticipantRequest;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.web.server.servlet.context.ServletWebServerInitializedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.validation.BeanPropertyBindingResult;
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
        prepareRequest();
    }

    @EventListener
    void onWebServerInitialized(ServletWebServerInitializedEvent event) {
        var context = event.getApplicationContext();
        var servlet = context.getServletContext();
        if (servlet == null || servlet.getClassLoader() == null) {
            throw new IllegalStateException("Cannot prepare booking validation without a servlet class loader");
        }
        Thread thread = Thread.currentThread();
        ClassLoader original = thread.getContextClassLoader();
        try {
            thread.setContextClassLoader(servlet.getClassLoader());
            var request = prepareRequest();
            var errors = new BeanPropertyBindingResult(request, "booking");
            context.getBean("mvcValidator", org.springframework.validation.Validator.class).validate(request, errors);
            if (errors.hasErrors()) {
                throw new IllegalStateException("Cannot prepare servlet booking validation");
            }
            var controller = context.getBean(BookingController.class);
            var method = BookingController.class.getDeclaredMethod(
                    "createBooking", String.class, ApiCreateBookingRequest.class);
            if (!validator.forExecutables().validateParameters(
                    controller, method, new Object[]{"startup-preparation", request}).isEmpty()) {
                throw new IllegalStateException("Cannot prepare booking method validation");
            }
        } catch (NoSuchMethodException failure) {
            throw new IllegalStateException("Cannot resolve booking method validation", failure);
        } finally {
            thread.setContextClassLoader(original);
        }
    }

    private ApiCreateBookingRequest prepareRequest() {
        UUID identifier = new UUID(0, 0);
        var startsAt = Instant.EPOCH.atOffset(ZoneOffset.UTC);
        var request = new ApiCreateBookingRequest(Set.of(identifier), identifier, startsAt, startsAt.plusHours(1))
                .participants(List.of(new ApiParticipantRequest().personId(identifier)));
        var mapped = mapper.readValue(mapper.writeValueAsBytes(request), ApiCreateBookingRequest.class);
        if (!validator.validate(mapped).isEmpty()) {
            throw new IllegalStateException("Cannot prepare booking request validation");
        }
        return mapped;
    }
}
