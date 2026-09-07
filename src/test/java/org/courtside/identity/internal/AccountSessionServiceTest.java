package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.courtside.api.ApiBrowserFamily;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.RecentAuthentication;
import org.courtside.identity.UserAccount;
import org.courtside.shared.SecurityEventLog;
import org.junit.jupiter.api.Test;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AccountSessionServiceTest {

    private final FindByIndexNameSessionRepository<Session> repository = mock();
    private final CurrentUser currentUser = mock();
    private final RecentAuthentication recent = mock();
    private final AccountSessions accountSessions = mock();
    private final SecurityEventLog securityEvents = mock();
    private final HttpServletRequest request = mock();
    private final AccountSessionService service = new AccountSessionService(repository, currentUser,
            recent, accountSessions, securityEvents, request);

    @Test
    void givenStoredSessions_whenTheyAreListed_thenOnlyOpaquePrivacySafeMetadataIsReturned() {
        // given
        UserAccount account = account("member");
        HttpSession current = currentSession("raw-current-session-id");
        Session older = stored(Instant.parse("2026-09-07T10:00:00Z"), "FIREFOX");
        Session newer = stored(Instant.parse("2026-09-07T11:00:00Z"), "untrusted-value");
        var stored = new LinkedHashMap<String, Session>();
        stored.put("raw-other-session-id", older);
        stored.put("raw-current-session-id", newer);
        when(currentUser.requireAccount()).thenReturn(account);
        when(request.getSession(false)).thenReturn(current);
        when(repository.findByPrincipalName("member")).thenReturn(stored);

        // when
        var result = service.list();

        // then
        assertThat(result).hasSize(2);
        assertThat(result.getFirst().getCurrent()).isTrue();
        assertThat(result.getFirst().getBrowserFamily()).isEqualTo(ApiBrowserFamily.OTHER);
        assertThat(result.getFirst().getCreatedAt()).isEqualTo(
                OffsetDateTime.ofInstant(Instant.parse("2026-09-07T10:59:00Z"), ZoneOffset.UTC));
        assertThat(result.getFirst().getLastActivityAt()).isEqualTo(
                OffsetDateTime.ofInstant(Instant.parse("2026-09-07T11:00:00Z"), ZoneOffset.UTC));
        assertThat(result.getLast().getBrowserFamily()).isEqualTo(ApiBrowserFamily.FIREFOX);
        assertThat(result.getLast().getCreatedAt()).isEqualTo(
                OffsetDateTime.ofInstant(Instant.parse("2026-09-07T09:59:00Z"), ZoneOffset.UTC));
        assertThat(result.getLast().getLastActivityAt()).isEqualTo(
                OffsetDateTime.ofInstant(Instant.parse("2026-09-07T10:00:00Z"), ZoneOffset.UTC));
        assertThat(result).allSatisfy(item -> {
            assertThat(item.getHandle()).hasSize(22).doesNotContain("session");
            assertThat(item.toString()).doesNotContain("raw-", "User-Agent", "127.0.0.1");
        });
    }

    @Test
    void givenAnotherSession_whenItIsEnded_thenRecentAuthenticationIsRequired() {
        // given
        UserAccount account = account("member");
        currentSession("current-id");
        when(currentUser.requireAccount()).thenReturn(account);
        Session other = stored(Instant.now(), null);
        when(repository.findByPrincipalName("member"))
                .thenReturn(java.util.Map.of("other-id", other));

        // when
        boolean endedCurrent = service.endOne(AccountSessionService.handle("other-id"));

        // then
        assertThat(endedCurrent).isFalse();
        verify(recent).requireRecent();
        verify(repository).deleteById("other-id");
    }

    @Test
    void givenTheCurrentSession_whenItIsEnded_thenNoSecondPasswordProofIsRequired() {
        // given
        UserAccount account = account("member");
        currentSession("current-id");
        when(currentUser.requireAccount()).thenReturn(account);
        Session current = stored(Instant.now(), null);
        when(repository.findByPrincipalName("member"))
                .thenReturn(java.util.Map.of("current-id", current));

        // when
        boolean endedCurrent = service.endOne(AccountSessionService.handle("current-id"));

        // then
        assertThat(endedCurrent).isTrue();
        verify(recent, never()).requireRecent();
        verify(repository).deleteById("current-id");
    }

    @Test
    void givenUserAgents_whenTheyAreMapped_thenOnlyNormalizedBrowserFamiliesRemain() {
        // when / then
        assertThat(AccountSessionService.browserFamily("Mozilla/5.0 Version/18.0 Safari/605.1"))
                .isEqualTo(ApiBrowserFamily.SAFARI);
        assertThat(AccountSessionService.browserFamily("Mozilla/5.0 Edg/140.0 Chrome/140.0"))
                .isEqualTo(ApiBrowserFamily.EDGE);
        assertThat(AccountSessionService.browserFamily("unknown-client"))
                .isEqualTo(ApiBrowserFamily.OTHER);
    }

    @Test
    void givenAnUnknownHandle_whenASessionIsEnded_thenNothingIsDeleted() {
        // given
        UserAccount account = account("member");
        currentSession("current-id");
        when(currentUser.requireAccount()).thenReturn(account);
        when(repository.findByPrincipalName("member")).thenReturn(java.util.Map.of());

        // when / then
        assertThatThrownBy(() -> service.endOne("A234567890123456789012"))
                .isInstanceOf(AccountSessionNotFoundException.class);
        verify(repository, never()).deleteById(org.mockito.ArgumentMatchers.anyString());
        verify(recent, never()).requireRecent();
    }

    private UserAccount account(String username) {
        UserAccount account = mock(UserAccount.class);
        when(account.getUsername()).thenReturn(username);
        return account;
    }

    private HttpSession currentSession(String id) {
        HttpSession session = mock(HttpSession.class);
        when(session.getId()).thenReturn(id);
        when(request.getSession(false)).thenReturn(session);
        return session;
    }

    private Session stored(Instant lastActivity, String browser) {
        Session session = mock(Session.class);
        when(session.getCreationTime()).thenReturn(lastActivity.minusSeconds(60));
        when(session.getLastAccessedTime()).thenReturn(lastActivity);
        when(session.getAttribute("courtside.browser-family")).thenReturn(browser);
        return session;
    }
}
