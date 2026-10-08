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

import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
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
    private static final UUID MARY = UUID.fromString("8d3b5e4a-2f6c-4b9a-9c73-4eaf7f9b1c23");

    private final AtomicLong now = new AtomicLong();
    private final SecurityEventLog securityEvents = mock(SecurityEventLog.class);

    @AfterEach
    void clearPrincipal() {
        SecurityContextHolder.clearContext();
    }

    private AdmissionControl control(int accountBurst, Integer seriesConcurrency) {
        return control(accountBurst, seriesConcurrency, Duration.ZERO);
    }

    private AdmissionControl control(int accountBurst, Integer seriesConcurrency, Duration bulkheadWait) {
        AdmissionProperties properties = ShippedAdmission.withBulkheadWait(ShippedAdmission.withClass(
                ShippedAdmission.withAccountBurst(ShippedAdmission.defaults(), accountBurst),
                "booking-series", new AdmissionProperties.DemandClass(10, seriesConcurrency)), bulkheadWait);
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
        AdmissionControl control = control(20, null);
        signIn(JANE);
        control.preHandle(request(), new MockHttpServletResponse(), operation("previewSeries"));
        control.preHandle(request(), new MockHttpServletResponse(), operation("previewSeries"));

        // when
        signIn(JOHN);

        // then
        assertThatCode(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("previewSeries")))
                .as("each account spends its own budget, even from the same address")
                .doesNotThrowAnyException();
    }

    @Test
    void givenABulkheadPermitHeldByOneAccount_whenTheClassIsRequestedAgain_thenOnlyAnotherAccountMayTakeTheOther()
            throws Exception {
        // given
        AdmissionControl control = control(30, 2);
        signIn(JANE);
        HttpServletRequest janesPreview = request();
        control.preHandle(janesPreview, new MockHttpServletResponse(), operation("previewSeries"));

        // when / then
        assertThatThrownBy(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("createSeries")))
                .as("one account holds at most one permit of a class, so it cannot occupy the class alone")
                .isInstanceOf(OperationCapacityExhaustedException.class);
        signIn(JOHN);
        HttpServletRequest johnsSeries = request();
        assertThatCode(() -> control.preHandle(johnsSeries, new MockHttpServletResponse(), operation("createSeries")))
                .as("another account takes the second permit")
                .doesNotThrowAnyException();
        signIn(MARY);
        assertThatThrownBy(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("previewSeries")))
                .as("both permits are taken")
                .isInstanceOf(OperationCapacityExhaustedException.class);
        assertThatCode(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("createBooking")))
                .as("another class is not held up by it")
                .doesNotThrowAnyException();
        control.afterCompletion(janesPreview, new MockHttpServletResponse(), operation("previewSeries"), null);
        assertThatCode(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("previewSeries")))
                .as("completion returns the permit")
                .doesNotThrowAnyException();
        verify(securityEvents).controlRefused(JANE, SecurityEventLog.ControlRefusal.OPERATION_CAPACITY);
    }

    @Test
    void givenAnAccountsOwnRequestHoldsItsPlace_whenItSendsAnotherOfTheClass_thenTheSecondWaitsAndRunsAfterIt()
            throws Exception {
        // given
        AdmissionControl control = control(30, 2, Duration.ofSeconds(5));
        signIn(JANE);
        HttpServletRequest first = request();
        control.preHandle(first, new MockHttpServletResponse(), operation("previewSeries"));
        var principal = SecurityContextHolder.getContext().getAuthentication();

        // when
        CompletableFuture<Boolean> second = CompletableFuture.supplyAsync(() -> {
            SecurityContextHolder.getContext().setAuthentication(principal);
            try {
                return control.preHandle(request(), new MockHttpServletResponse(), operation("createSeries"));
            } catch (Exception failure) {
                throw new IllegalStateException(failure);
            } finally {
                SecurityContextHolder.clearContext();
            }
        });
        Thread.sleep(200);
        boolean admittedWhileTheFirstRuns = second.isDone();
        control.afterCompletion(first, new MockHttpServletResponse(), operation("previewSeries"), null);

        // then
        assertThat(admittedWhileTheFirstRuns).as("the second request waits for the account's own place").isFalse();
        assertThat(second.get(5, TimeUnit.SECONDS)).as("and runs once the first completes").isTrue();
    }

    @Test
    void givenAnAccountsOwnRequestKeepsItsPlace_whenTheWaitRunsOut_thenTheSecondIsRefused() throws Exception {
        // given
        AdmissionControl control = control(30, 2, Duration.ofMillis(100));
        signIn(JANE);
        control.preHandle(request(), new MockHttpServletResponse(), operation("previewSeries"));

        // when / then
        assertThatThrownBy(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("createSeries")))
                .as("the wait is bounded, so a stuck request cannot hold its caller's next one forever")
                .isInstanceOf(OperationCapacityExhaustedException.class);
    }

    @Test
    void givenAFullBulkhead_whenItRefusesARequest_thenTheRequestKeepsItsTokens() throws Exception {
        // given
        AdmissionControl control = control(20, 1);
        signIn(JOHN);
        control.preHandle(request(), new MockHttpServletResponse(), operation("previewSeries"));
        signIn(JANE);
        assertThatThrownBy(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("previewSeries")))
                .isInstanceOf(OperationCapacityExhaustedException.class);

        // when / then
        assertThatCode(() -> {
            for (int request = 0; request < 20; request++) {
                control.preHandle(request(), new MockHttpServletResponse(), operation("unknownOperation"));
            }
        }).as("a request the class refused spent none of the twenty tokens").doesNotThrowAnyException();
    }

    @Test
    void givenTheShippedBudgets_whenAnAdministratorOpensTheOverviewAndTheStatisticsAndChangesThePeriod_thenNothingIsRefused()
            throws Exception {
        // given
        AdmissionProperties shipped = ShippedAdmission.defaults();
        AdmissionControl control = new AdmissionControl(AdmissionPlan.load(shipped, JsonMapper.builder().build()),
                new RequestBudgets(100, now::get), shipped, securityEvents);
        signIn(JANE);
        List<String> overview = List.of("readUtilisationStatistics", "readBookingStatistics", "readMemberStatistics");
        List<String> statistics = List.of("readStatisticsRange", "readUtilisationStatistics", "readBookingStatistics",
                "readMemberStatistics", "readMessageStatistics");

        // when / then
        assertThatCode(() -> {
            for (List<String> page : List.of(overview, statistics, statistics, statistics)) {
                for (String operation : page) {
                    HttpServletRequest request = request();
                    control.preHandle(request, new MockHttpServletResponse(), reportOperation(operation));
                    control.afterCompletion(request, new MockHttpServletResponse(), reportOperation(operation), null);
                }
            }
        }).as("a board looking at its figures at human speed never meets its own budget")
                .doesNotThrowAnyException();
    }

    @Test
    void givenAnUnclassifiedHandler_whenRequested_thenItCostsOneTokenAndHasNoBulkhead() throws Exception {
        // given
        AdmissionControl control = control(20, 1);
        signIn(JANE);

        // when
        boolean admitted = true;
        for (int request = 0; request < 20; request++) {
            admitted &= control.preHandle(request(), new MockHttpServletResponse(), operation("unknownOperation"));
        }

        // then
        assertThat(admitted).as("twenty tokens admit twenty unclassified requests, all in parallel").isTrue();
        assertThatThrownBy(() -> control.preHandle(request(), new MockHttpServletResponse(), operation("unknownOperation")))
                .isInstanceOf(RequestRateLimitedException.class);
    }

    private static HandlerMethod reportOperation(String name) throws NoSuchMethodException {
        return new HandlerMethod(new ReportOperations(), ReportOperations.class.getDeclaredMethod(name));
    }

    static class ReportOperations {
        void readStatisticsRange() {
        }

        void readUtilisationStatistics() {
        }

        void readBookingStatistics() {
        }

        void readMemberStatistics() {
        }

        void readMessageStatistics() {
        }
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
