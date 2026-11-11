package org.courtside.credit.internal;

import org.courtside.credit.CreditEntryKind;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.RecentAuthentication;
import org.courtside.config.ClubCurrency;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Clock;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class LedgerGuardTest {

    @Test
    void givenAnIdempotencyKeyWithInvisibleCharacters_whenRecording_thenItIsRefusedBeforeTheLedgerIsRead() {
        // given
        JdbcClient jdbc = mock(JdbcClient.class);
        CreditLedger ledger = new CreditLedger(jdbc, mock(EntityManager.class), mock(ClubCurrency.class),
                mock(CurrentUser.class), mock(RecentAuthentication.class), mock(ApplicationEventPublisher.class),
                Clock.systemUTC());

        // when / then
        assertThatThrownBy(() -> ledger.record(UUID.randomUUID(), CreditEntryKind.CREDIT, 500, "Cash", "key with space"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("The idempotency key must be 1 to 128 visible ASCII characters");
        verifyNoInteractions(jdbc);
    }

    @Test
    void givenNoAccount_whenTheLedgerIsLocked_thenItIsRefused() {
        // given
        JdbcClient jdbc = mock(JdbcClient.class);

        // when / then
        assertThatThrownBy(() -> new LedgerBalances(jdbc).lock(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("A ledger lock belongs to an account");
        verifyNoInteractions(jdbc);
    }
}
