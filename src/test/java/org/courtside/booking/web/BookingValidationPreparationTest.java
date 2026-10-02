package org.courtside.booking.web;

import jakarta.validation.Validation;
import jakarta.validation.ValidationException;
import jakarta.validation.Validator;
import org.courtside.api.ApiCreateBookingRequest;
import org.courtside.api.ApiParticipantRequest;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BookingValidationPreparationTest {

    @Test
    void givenTheApplicationValidator_whenSingletonsInitialize_thenBookingMetadataIsPreparedBeforeRequests() {
        // given
        Validator validator = mock(Validator.class);
        ObjectMapper mapper = spy(JsonMapper.builder().build());
        try (var context = new AnnotationConfigApplicationContext()) {
            context.registerBean(Validator.class, () -> validator);
            context.registerBean(ObjectMapper.class, () -> mapper);
            context.register(BookingValidationPreparation.class);

            // when
            context.refresh();

            // then
            verify(validator).getConstraintsForClass(BookingController.class);
            verify(validator).getConstraintsForClass(ApiCreateBookingRequest.class);
            verify(validator).getConstraintsForClass(ApiParticipantRequest.class);
            verify(validator).validate(any(ApiCreateBookingRequest.class));
            verify(mapper).readValue(any(byte[].class), eq(ApiCreateBookingRequest.class));
        }
    }

    @Test
    void givenInvalidConstraintMetadata_whenSingletonsInitialize_thenStartupFailsClosed() {
        // given
        Validator validator = mock(Validator.class);
        when(validator.getConstraintsForClass(BookingController.class))
                .thenThrow(new ValidationException("Invalid booking constraints"));
        try (var context = new AnnotationConfigApplicationContext()) {
            context.registerBean(Validator.class, () -> validator);
            context.registerBean(ObjectMapper.class, () -> JsonMapper.builder().build());
            context.register(BookingValidationPreparation.class);

            // when / then
            assertThatThrownBy(context::refresh).hasMessageContaining("Invalid booking constraints");
            assertThat(context.isActive()).isFalse();
        }
    }

    @Test
    void givenPreparationInputThatFailsValidation_whenSingletonsInitialize_thenStartupFailsClosed() {
        // given
        try (var factory = Validation.buildDefaultValidatorFactory();
             var context = new AnnotationConfigApplicationContext()) {
            Validator validator = mock(Validator.class);
            when(validator.validate(any(ApiCreateBookingRequest.class)))
                    .thenReturn(factory.getValidator().validate(new ApiCreateBookingRequest()));
            context.registerBean(Validator.class, () -> validator);
            context.registerBean(ObjectMapper.class, () -> JsonMapper.builder().build());
            context.register(BookingValidationPreparation.class);

            // when / then
            assertThatThrownBy(context::refresh).hasMessageContaining("Cannot prepare booking request validation");
            assertThat(context.isActive()).isFalse();
        }
    }

    @Test
    void givenBrokenRequestMapping_whenSingletonsInitialize_thenStartupFailsClosed() {
        // given
        Validator validator = mock(Validator.class);
        ObjectMapper mapper = mock(ObjectMapper.class);
        when(mapper.writeValueAsBytes(any(ApiCreateBookingRequest.class)))
                .thenThrow(new IllegalStateException("Broken booking mapping"));
        try (var context = new AnnotationConfigApplicationContext()) {
            context.registerBean(Validator.class, () -> validator);
            context.registerBean(ObjectMapper.class, () -> mapper);
            context.register(BookingValidationPreparation.class);

            // when / then
            assertThatThrownBy(context::refresh).hasMessageContaining("Broken booking mapping");
            assertThat(context.isActive()).isFalse();
        }
    }

    @Test
    void givenPreparedMetadata_whenAnEmptyBookingIsValidated_thenRequiredFieldsRemainRejected() {
        // given
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            Validator validator = factory.getValidator();
            new BookingValidationPreparation(validator, JsonMapper.builder().build()).afterSingletonsInstantiated();

            // when
            var violations = validator.validate(new ApiCreateBookingRequest());

            // then
            assertThat(violations).extracting(violation -> violation.getPropertyPath().toString())
                    .contains("courtIds", "cardId", "startsAt", "endsAt");
        }
    }

    @Test
    void givenPreparedMetadata_whenARequiredMethodParameterIsMissing_thenItsConstraintRemainsActive()
            throws Exception {
        // given
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            Validator validator = factory.getValidator();
            new BookingValidationPreparation(validator, JsonMapper.builder().build()).afterSingletonsInstantiated();
            BookingController controller = mock(BookingController.class);
            var method = BookingController.class.getDeclaredMethod(
                    "createBooking", String.class, ApiCreateBookingRequest.class);

            // when
            var violations = validator.forExecutables().validateParameters(
                    controller, method, new Object[]{null, new ApiCreateBookingRequest()});

            // then
            assertThat(violations).filteredOn(violation -> violation.getLeafBean() == controller)
                    .singleElement().satisfies(violation -> {
                        assertThat(violation.getPropertyPath().toString()).startsWith("createBooking.");
                        assertThat(violation.getConstraintDescriptor().getAnnotation())
                                .isInstanceOf(jakarta.validation.constraints.NotNull.class);
                    });
        }
    }
}
