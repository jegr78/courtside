package org.courtside.identity;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AccountSessionsTest {

    @Mock private FindByIndexNameSessionRepository<Session> repository;

    @Test
    void givenSeveralStoredSessions_whenTheyAreEnded_thenEveryRowIsDeleted() {
        // given
        when(repository.findByPrincipalName("doe.jane"))
                .thenReturn(Map.of("first", mock(Session.class), "second", mock(Session.class)));

        // when
        new AccountSessions(repository).endFor("doe.jane");

        // then
        verify(repository).deleteById("first");
        verify(repository).deleteById("second");
    }

    @Test
    void givenTheStoreRefusesTheDeletion_whenSessionsAreEnded_thenTheOperationThatRevokedThemStands() {
        // given
        when(repository.findByPrincipalName("doe.jane"))
                .thenThrow(new IllegalStateException("the session store is unavailable"));

        // when / then
        assertThatCode(() -> new AccountSessions(repository).endFor("doe.jane"))
                .doesNotThrowAnyException();
    }
}
