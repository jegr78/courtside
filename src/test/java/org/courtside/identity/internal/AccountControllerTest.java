package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.courtside.api.ApiInitialPasswordChangeRequest;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AccountControllerTest {

    private final InitialPasswordService passwords = mock(InitialPasswordService.class);
    private final AccountLocaleService locales = mock(AccountLocaleService.class);
    private final HttpServletRequest request = mock(HttpServletRequest.class);
    private final AccountController controller = new AccountController(passwords, locales, request);

    @Test
    void givenAnExistingSession_whenChangingTheInitialPassword_thenTheSessionIsInvalidated() {
        // given
        HttpSession session = mock(HttpSession.class);
        when(request.getSession(false)).thenReturn(session);
        ApiInitialPasswordChangeRequest change = new ApiInitialPasswordChangeRequest("new-password");

        // when
        var response = controller.changeInitialPassword(change);

        // then
        assertThat(response.getStatusCode().value()).isEqualTo(204);
        InOrder handling = inOrder(passwords, request, session);
        handling.verify(passwords).change("new-password");
        handling.verify(request).getSession(false);
        handling.verify(session).invalidate();
        verifyNoInteractions(locales);
    }

    @Test
    void givenTheSessionWasAlreadyRemoved_whenChangingTheInitialPassword_thenTheRequestStillSucceeds() {
        // given
        when(request.getSession(false)).thenReturn(null);
        ApiInitialPasswordChangeRequest change = new ApiInitialPasswordChangeRequest("new-password");

        // when
        var response = controller.changeInitialPassword(change);

        // then
        assertThat(response.getStatusCode().value()).isEqualTo(204);
        InOrder handling = inOrder(passwords, request);
        handling.verify(passwords).change("new-password");
        handling.verify(request).getSession(false);
        verifyNoInteractions(locales);
    }

    @Test
    void givenTheSessionIsInvalidatedConcurrently_whenChangingTheInitialPassword_thenTheRequestStillSucceeds() {
        // given
        HttpSession session = mock(HttpSession.class);
        when(request.getSession(false)).thenReturn(session);
        doThrow(new IllegalStateException("Session already invalidated")).when(session).invalidate();
        ApiInitialPasswordChangeRequest change = new ApiInitialPasswordChangeRequest("new-password");

        // when
        var response = controller.changeInitialPassword(change);

        // then
        assertThat(response.getStatusCode().value()).isEqualTo(204);
        InOrder handling = inOrder(passwords, request, session);
        handling.verify(passwords).change("new-password");
        handling.verify(request).getSession(false);
        handling.verify(session).invalidate();
        verifyNoInteractions(locales);
    }
}
