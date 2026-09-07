package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.courtside.api.AccountApi;
import org.courtside.api.ApiAccountLocaleRequest;
import org.courtside.api.ApiInitialPasswordChangeRequest;
import org.courtside.api.ApiPasswordChangeRequest;
import org.courtside.api.ApiAccountSession;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class AccountController implements AccountApi {

    private final InitialPasswordService passwords;
    private final PermanentPasswordService permanentPasswords;
    private final AccountSessionService sessions;
    private final AccountLocaleService locales;
    private final HttpServletRequest request;
    @Override
    public ResponseEntity<Void> changeInitialPassword(ApiInitialPasswordChangeRequest change) {
        passwords.change(change.getPassword());
        invalidateCurrentSession();
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> changeOwnPassword(ApiPasswordChangeRequest change) {
        permanentPasswords.change(change.getCurrentPassword(), change.getNewPassword());
        invalidateCurrentSession();
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<List<ApiAccountSession>> listOwnSessions() {
        return ResponseEntity.ok(sessions.list());
    }

    @Override
    public ResponseEntity<Void> endOwnSession(String sessionHandle) {
        if (sessions.endOne(sessionHandle)) {
            invalidateCurrentSession();
        }
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> endOwnSessions() {
        sessions.endAll();
        invalidateCurrentSession();
        return ResponseEntity.noContent().build();
    }

    private void invalidateCurrentSession() {
        HttpSession session = request.getSession(false);
        if (session != null) {
            try {
                session.invalidate();
            } catch (IllegalStateException ignored) {
                // Another request already achieved the required state.
            }
        }
    }

    @Override
    public ResponseEntity<Void> changeOwnLocale(ApiAccountLocaleRequest change) {
        locales.change(change.getLocale());
        return ResponseEntity.noContent().build();
    }
}
