package org.courtside.notification.internal;

import jakarta.mail.Address;
import jakarta.mail.SendFailedException;
import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;
import org.junit.jupiter.api.Test;
import org.springframework.mail.MailSendException;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MailHandoverTest {

    private static final String MESSAGE_ID = "<message@courtside.test>";

    private final List<Duration> gaps = new ArrayList<>();
    private final MailHandover handover = new MailHandover(gaps::add);

    @Test
    void givenARecipientTheServerRejects_whenHandingOver_thenItIsNotTriedAgain() {
        // given
        AtomicInteger attempts = new AtomicInteger();

        // when / then — the address does not exist, and it will not exist in five seconds either
        assertThatThrownBy(() -> handover.attempt(MESSAGE_ID, () -> {
            attempts.incrementAndGet();
            throw rejected("550 5.1.1 unknown recipient");
        })).isInstanceOf(MailRecipientRefusedException.class);
        assertThat(attempts).hasValue(1);
        assertThat(gaps).isEmpty();
    }

    @Test
    void givenARefusal_whenItIsReported_thenItCarriesTheCodeAndNotTheRelaysWordsOrTheAddress() {
        // when
        MailRecipientRefusedException refusal = (MailRecipientRefusedException)
                org.assertj.core.api.Assertions.catchThrowable(() -> handover.attempt(MESSAGE_ID,
                        () -> { throw rejected("550 5.1.1 <nobody@example.org> user unknown"); }));

        // then — enough to tell a wrong address from an absent relay, and nothing beyond it
        assertThat(refusal.statusCode()).isEqualTo("550");
        assertThat(refusal.diagnosis())
                .as("what the mail library reported, not the wrapper this class throws around it")
                .doesNotStartWith("MailHandoverFailedException");
        assertThat(refusal.getMessage())
                .doesNotContain("nobody@example.org")
                .doesNotContain("user unknown");
    }

    // What Spring builds for a rejected recipient: the mail library's exception is a failed message
    // and not a cause, so a walk that only follows getCause never sees the refusal at all.
    private static RuntimeException rejected(String reply) {
        return new MailSendException(Map.of("<message@courtside.test>", refusedBy(reply)));
    }

    private static RuntimeException rejectedAsACause(String reply) {
        return new MailSendException("the relay refused the recipient", refusedBy(reply));
    }

    private static SendFailedException refusedBy(String reply) {
        try {
            return new SendFailedException(reply, null, new Address[0], new Address[0],
                    new Address[]{new InternetAddress("nobody@example.org")});
        } catch (AddressException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    @Test
    void givenASenderThatReportsARefusalAsACause_whenHandingOver_thenItIsStillNotTriedAgain() {
        // given — the shape a hand-built failure has, and the one this walk used to see alone
        AtomicInteger attempts = new AtomicInteger();

        // when / then
        assertThatThrownBy(() -> handover.attempt(MESSAGE_ID, () -> {
            attempts.incrementAndGet();
            throw rejectedAsACause("550 5.1.1 unknown recipient");
        })).isInstanceOf(MailRecipientRefusedException.class);
        assertThat(attempts).hasValue(1);
    }

    @Test
    void givenAServerThatAnswers_whenHandingOver_thenItIsTriedOnceAndNothingIsRepeated() {
        // given
        AtomicInteger attempts = new AtomicInteger();

        // when
        handover.attempt(MESSAGE_ID, attempts::incrementAndGet);

        // then
        assertThat(attempts).hasValue(1);
        assertThat(gaps).isEmpty();
    }

    @Test
    void givenAServerRestarting_whenItAnswersOnTheSecondTry_thenTheMessageIsNotGivenUpOn() {
        // given
        AtomicInteger attempts = new AtomicInteger();

        // when
        handover.attempt(MESSAGE_ID, () -> {
            if (attempts.incrementAndGet() < 2) {
                throw new IllegalStateException("the server is restarting");
            }
        });

        // then
        assertThat(attempts).hasValue(2);
        assertThat(gaps).containsExactly(Duration.ofSeconds(5));
    }

    @Test
    void givenAServerThatStaysAway_whenTheGapsAreExhausted_thenTheHandoverFailsRatherThanReturning() {
        // given
        AtomicInteger attempts = new AtomicInteger();

        // when / then
        assertThatThrownBy(() -> handover.attempt(MESSAGE_ID, () -> {
            attempts.incrementAndGet();
            throw new IllegalStateException("nothing is listening");
        })).isInstanceOf(MailHandoverFailedException.class);

        // then — four tries inside a minute, because a neighbour that is restarting is back by then
        assertThat(attempts).hasValue(4);
        assertThat(gaps).containsExactly(
                Duration.ofSeconds(5), Duration.ofSeconds(15), Duration.ofSeconds(45));
        assertThat(gaps.stream().reduce(Duration.ZERO, Duration::plus))
                .isLessThan(Duration.ofMinutes(2));
    }

    @Test
    void givenARelayThatNamesTheRecipient_whenGivingUp_thenWhatEscapesDoesNotCarryTheAddress() {
        // given — a rejected recipient is reported with the address it rejected
        Runnable rejecting = () -> {
            throw new IllegalStateException("550 5.1.1 <jane.doe@example.org> recipient unknown");
        };

        // when / then — the listener is async, so whatever escapes is logged with its whole chain
        assertThatThrownBy(() -> handover.attempt(MESSAGE_ID, rejecting))
                .satisfies(failure -> assertThat(fullTrace(failure))
                        .as("no log line may carry a member's address")
                        .doesNotContain("jane.doe@example.org")
                        .contains(MESSAGE_ID)
                        .contains("IllegalStateException"));
    }

    private static String fullTrace(Throwable failure) {
        StringWriter rendered = new StringWriter();
        failure.printStackTrace(new PrintWriter(rendered));
        return rendered.toString();
    }

}
