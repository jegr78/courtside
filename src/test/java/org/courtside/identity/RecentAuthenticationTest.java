package org.courtside.identity;

import org.courtside.shared.SecurityEventLog;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class RecentAuthenticationTest {

    private static final Instant NOW = Instant.parse("2026-09-07T12:00:00Z");

    @Test
    void givenAProofExactlyFiveMinutesOld_whenAProtectedOperationChecksIt_thenItIsAccepted() {
        // given
        MockHttpServletRequest request = requestWithProof(NOW.minus(Duration.ofMinutes(5)));
        RecentAuthentication authentication = authentication(request);

        // when / then
        assertThatCode(authentication::requireRecent).doesNotThrowAnyException();
    }

    @Test
    void givenAProofOlderThanFiveMinutes_whenAProtectedOperationChecksIt_thenItIsRefused() {
        // given
        MockHttpServletRequest request = requestWithProof(NOW.minus(Duration.ofMinutes(5)).minusMillis(1));
        SecurityEventLog events = mock(SecurityEventLog.class);
        RecentAuthentication authentication = authentication(request, events);

        // when / then
        assertThatThrownBy(authentication::requireRecent)
                .isInstanceOf(RecentAuthenticationRequiredException.class);
        verify(events).controlRefusedForCurrentAccount(SecurityEventLog.ControlRefusal.RECENT_AUTHENTICATION);
    }

    @Test
    void givenNoProof_whenTheCurrentFactorsAreRecorded_thenTheSessionCarriesTheCurrentInstant() {
        // given
        MockHttpServletRequest request = new MockHttpServletRequest();
        RecentAuthentication authentication = authentication(request);

        // when
        authentication.record();

        // then
        assertThatCode(authentication::requireRecent).doesNotThrowAnyException();
    }

    @Test
    void givenAProofFromAClockThatMovedBackwards_whenItIsChecked_thenItIsRefused() {
        // given
        RecentAuthentication authentication = authentication(requestWithProof(NOW.plusMillis(1)));

        // when / then
        assertThatThrownBy(authentication::requireRecent)
                .isInstanceOf(RecentAuthenticationRequiredException.class);
    }

    private static MockHttpServletRequest requestWithProof(Instant instant) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession().setAttribute(RecentAuthentication.AUTHENTICATED_AT, instant.toEpochMilli());
        return request;
    }

    private static RecentAuthentication authentication(MockHttpServletRequest request) {
        return authentication(request, mock(SecurityEventLog.class));
    }

    private static RecentAuthentication authentication(MockHttpServletRequest request, SecurityEventLog events) {
        return new RecentAuthentication(request, Duration.ofMinutes(5),
                Clock.fixed(NOW, ZoneOffset.UTC), events);
    }
}
