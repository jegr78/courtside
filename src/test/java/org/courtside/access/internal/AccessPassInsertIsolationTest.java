package org.courtside.access.internal;

import org.courtside.access.internal.ScriptedAccessControl.Kind;
import org.courtside.shared.BookingAnnouncer;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.doThrow;

class AccessPassInsertIsolationTest extends AccessPassTestSupport {

    @MockitoSpyBean
    private BookingAnnouncer announcer;

    @Test
    void givenADemandQueryThatFails_whenThePassRuns_thenItStillRevokesWhatIsNoLongerWanted() {
        // given
        UUID booking = book(courts.get(0));
        pass.runPassNow();
        cancel(booking);
        doThrow(new IllegalStateException("demand query failed")).when(announcer)
                .accessDemandsStartingBefore(any(), any(), any(), anyInt());

        // when
        PassResult result = passAt(START.plus(Duration.ofMinutes(1)));

        // then
        assertThat(result).isEqualTo(new PassResult.Completed());
        assertThat(connector.calls(Kind.REVOKE)).as("the insert step failed, the act step still ran").hasSize(1);
        assertThat(grantOf(booking).getRemote()).isEqualTo(RemoteState.NONE);
    }
}
