package org.courtside.booking.web;

import jakarta.servlet.ServletContext;
import jakarta.validation.Validation;
import jakarta.validation.ValidationException;
import jakarta.validation.Validator;
import jakarta.validation.executable.ExecutableValidator;
import org.courtside.api.ApiCreateBookingRequest;
import org.courtside.api.ApiParticipantRequest;
import org.junit.jupiter.api.Test;
import org.springframework.boot.web.server.WebServer;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.boot.web.server.servlet.context.ServletWebServerInitializedEvent;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.validation.Errors;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class BookingValidationPreparationTest {

    @Test
    void givenAServletClassLoader_whenTheWebServerStarts_thenValidationIsPreparedWithoutCallingTheController() {
        // given
        ClassLoader original = Thread.currentThread().getContextClassLoader();
        ClassLoader servletLoader = new ClassLoader(original) {};
        Validator validator = mock(Validator.class);
        ExecutableValidator executable = mock(ExecutableValidator.class);
        when(validator.forExecutables()).thenReturn(executable);
        var loaders = new ArrayList<ClassLoader>();
        doAnswer(invocation -> {
            loaders.add(Thread.currentThread().getContextClassLoader());
            return Set.of();
        }).when(validator).validate(any(ApiCreateBookingRequest.class));
        doAnswer(invocation -> {
            loaders.add(Thread.currentThread().getContextClassLoader());
            return Set.of();
        }).when(executable).validateParameters(any(), any(), any(Object[].class));
        BookingController controller = mock(BookingController.class);
        var event = webServerEvent(servletLoader, controller);
        var mvc = event.getApplicationContext().getBean("mvcValidator", org.springframework.validation.Validator.class);
        doAnswer(invocation -> {
            loaders.add(Thread.currentThread().getContextClassLoader());
            return null;
        }).when(mvc).validate(any(ApiCreateBookingRequest.class), any(Errors.class));
        try (var context = preparationContext(validator)) {
            context.refresh();

            // when
            context.publishEvent(event);

            // then
            assertThat(loaders).containsExactly(original, servletLoader, servletLoader, servletLoader);
            assertThat(Thread.currentThread().getContextClassLoader()).isSameAs(original);
            verifyNoInteractions(controller);
        }
    }

    @Test
    void givenFailedMvcBindingValidation_whenTheWebServerStarts_thenStartupFailsAndTheClassLoaderIsRestored() {
        // given
        ClassLoader original = Thread.currentThread().getContextClassLoader();
        Validator validator = mock(Validator.class);
        when(validator.forExecutables()).thenReturn(mock(ExecutableValidator.class));
        BookingController controller = mock(BookingController.class);
        var event = webServerEvent(new ClassLoader(original) {}, controller);
        var mvc = event.getApplicationContext().getBean("mvcValidator", org.springframework.validation.Validator.class);
        doAnswer(invocation -> {
            invocation.<Errors>getArgument(1).reject("invalid.preparation");
            return null;
        }).when(mvc).validate(any(ApiCreateBookingRequest.class), any(Errors.class));
        try (var context = preparationContext(validator)) {
            context.refresh();

            // when / then
            assertThatThrownBy(() -> context.publishEvent(event))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("Cannot prepare servlet booking validation");
            assertThat(Thread.currentThread().getContextClassLoader()).isSameAs(original);
            verifyNoInteractions(controller);
        }
    }

    @Test
    void givenFailedServletValidation_whenTheWebServerStarts_thenTheFailurePropagatesAndTheClassLoaderIsRestored() {
        // given
        ClassLoader original = Thread.currentThread().getContextClassLoader();
        Validator validator = mock(Validator.class);
        var event = webServerEvent(new ClassLoader(original) {}, mock(BookingController.class));
        try (var context = preparationContext(validator)) {
            context.refresh();
            when(validator.validate(any(ApiCreateBookingRequest.class)))
                    .thenThrow(new ValidationException("Servlet validation failure"));

            // when / then
            assertThatThrownBy(() -> context.publishEvent(event))
                    .isInstanceOf(ValidationException.class).hasMessage("Servlet validation failure");
            assertThat(Thread.currentThread().getContextClassLoader()).isSameAs(original);
        }
    }

    private static AnnotationConfigApplicationContext preparationContext(Validator validator) {
        var context = new AnnotationConfigApplicationContext();
        context.registerBean(Validator.class, () -> validator);
        context.registerBean(ObjectMapper.class, () -> JsonMapper.builder().build());
        context.register(BookingValidationPreparation.class);
        return context;
    }

    private static ServletWebServerInitializedEvent webServerEvent(ClassLoader loader, BookingController controller) {
        ServletContext servlet = mock(ServletContext.class);
        when(servlet.getClassLoader()).thenReturn(loader);
        var web = mock(ServletWebServerApplicationContext.class);
        when(web.getServletContext()).thenReturn(servlet);
        when(web.getBean(BookingController.class)).thenReturn(controller);
        when(web.getBean("mvcValidator", org.springframework.validation.Validator.class))
                .thenReturn(mock(org.springframework.validation.Validator.class));
        return new ServletWebServerInitializedEvent(mock(WebServer.class), web);
    }

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
