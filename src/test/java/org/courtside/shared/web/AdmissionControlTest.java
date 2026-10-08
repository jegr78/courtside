package org.courtside.shared.web;

import jakarta.servlet.http.HttpServletRequest;
import org.courtside.shared.SecurityEventLog;
import org.courtside.shared.SecurityEventPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.method.HandlerMethod;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

class AdmissionControlTest {

    private static final UUID JANE = UUID.fromString("6b1f3c2e-0d4a-4f7e-9a51-2c8e5d7f9a01");
    private static final UUID JOHN = UUID.fromString("7c2a4d3f-1e5b-4a8f-8b62-3d9f6e8a0b12");

    private final AtomicLong now = new AtomicLong();
    private final SecurityEventLog securityEvents = mock(SecurityEventLog.class);

    @AfterEach
    void clearPrincipal() {
        SecurityContextHolder.clearContext();
    }

    private AdmissionControl control(int accountBurst, Integer seriesConcurrency) {
        AdmissionProperties properties = new AdmissionProperties(
                new AdmissionProperties.Limit(accountBurst, 1), new AdmissionProperties.Limit(100, 1), 100,
                Map.of("booking-series", new AdmissionProperties.DemandClass(10, seriesConcurrency),
                        "booking-write", new AdmissionProperties.DemandClass(1, null),
                        "password-and-credential-work", new AdmissionProperties.DemandClass(1, null),
                        "tenant-scaled-reads", new AdmissionProperties.DemandClass(1, null),
                        "administrative-impact-analysis", new AdmissionProperties.DemandClass(1, 2),
                        "bulk-report-and-export", new AdmissionProperties.DemandClass(1, 2),
                        "roster-import", new AdmissionProperties.DemandClass(1, 1),
                        "operational-log-search", new AdmissionProperties.DemandClass(1, 1),
                        "logo-normalization", new AdmissionProperties.DemandClass(1, 1),
                        "global-session-revocation", new AdmissionProperties.DemandClass(1, 1)));
        return new AdmissionControl(AdmissionPlan.load(properties, JsonMapper.builder().build()),
                new RequestBudgets(100, now::get), properties, securityEvents);
    }

    private static void signIn(UUID accountId) {
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(
                (SecurityEventPrincipal) () -> accountId, null, List.of()));
    }

    private static HandlerMethod operation(String name) throws NoSuchMethodException {
        return new HandlerMethod(new Operations(), Operations.class.getDeclaredMethod(name));
    }

    private static HttpServletRequest request() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/booking-series-preview");
        request.setRemoteAddr("192.0.2.10");
        return request;
    }

    @Test
    void givenAnAccountThatSpentItsBudget_whenItRequestsAgain_thenItIsRefusedAndOnlyTheFirstRefusalIsLogged()
            throws Exception {
        // given
        AdmissionControl control = control(20, null);
        signIn(JANE);
        HttpServletRequest request = request();
        control.preHandle(request, new MockHttpServletResponse(), operation("previewSeries"));
        control.preHandle(request, new MockHttpServletResponse(), operation("previewSeries"));

        // when / then
        for (int refused = 0; refused < 2; refused++) {
            assertThatThrownBy(() -> control.preHandle(request, new MockHttpServletResponse(), operation("previewSeries")))
                    .as("two previews at cost ten spend a burst of twenty")
                    .isInstanceOf(RequestRateLimitedException.class);
        }
        verify(securityEvents, times(1)).controlTriggered(JANE, SecurityEventLog.ControlTrigger.REQUEST_BUDGET);
    }

    @Test
    void givenOneAccountSpentItsBudget_whenAnotherAccountRequests_thenTheOtherIsAdmitted() throws Exception {
        // given
        AdmissionControl control = control(10, null);
        signIn(JANE);
        control.preHandle(request(), new MockHttpServletResponse(), operation("previewSeries"));

        // when
        signIn(JOHN);

        // then
        assertThatCode(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("previewSeries")))
                .as("each account spends its own budget, even from the same address")
                .doesNotThrowAnyException();
    }

    @Test
    void givenABulkheadIsOccupied_whenTheSameClassIsRequested_thenItIsRefusedUntilThePermitReturns() throws Exception {
        // given
        AdmissionControl control = control(1000, 1);
        signIn(JANE);
        HttpServletRequest first = request();
        control.preHandle(first, new MockHttpServletResponse(), operation("previewSeries"));

        // when / then
        assertThatThrownBy(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("createSeries")))
                .as("every operation of the class shares its bulkhead")
                .isInstanceOf(OperationCapacityExhaustedException.class);
        assertThatCode(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("createBooking")))
                .as("another class is not held up by it")
                .doesNotThrowAnyException();
        control.afterCompletion(first, new MockHttpServletResponse(), operation("previewSeries"), null);
        assertThatCode(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("createSeries")))
                .as("completion returns the permit")
                .doesNotThrowAnyException();
        verify(securityEvents).controlRefused(JANE, SecurityEventLog.ControlRefusal.OPERATION_CAPACITY);
    }

    @Test
    void givenAnUnclassifiedHandler_whenRequested_thenItCostsOneTokenAndHasNoBulkhead() throws Exception {
        // given
        AdmissionControl control = control(10, 1);
        signIn(JANE);

        // when
        boolean admitted = true;
        for (int request = 0; request < 10; request++) {
            admitted &= control.preHandle(request(), new MockHttpServletResponse(), operation("unknownOperation"));
        }

        // then
        assertThat(admitted).as("ten tokens admit ten unclassified requests, all in parallel").isTrue();
        assertThatThrownBy(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("unknownOperation")))
                .isInstanceOf(RequestRateLimitedException.class);
    }

    static class Operations {
        void previewSeries() {
        }

        void createSeries() {
        }

        void createBooking() {
        }

        void unknownOperation() {
        }
    }
}
