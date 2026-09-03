package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.courtside.api.AccountApi;
import org.courtside.api.ApiAccountLocaleRequest;
import org.courtside.api.ApiInitialPasswordChangeRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class AccountController implements AccountApi {

    private final InitialPasswordService passwords;
    private final AccountLocaleService locales;
    private final HttpServletRequest request;
    @Override
    public ResponseEntity<Void> changeInitialPassword(ApiInitialPasswordChangeRequest change) {
        passwords.change(change.getPassword());
        HttpSession session = request.getSession(false);
        if (session != null) {
            try {
                session.invalidate();
            } catch (IllegalStateException ignored) {
                // Another request already achieved the required state.
            }
        }
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> changeOwnLocale(ApiAccountLocaleRequest change) {
        locales.change(change.getLocale());
        return ResponseEntity.noContent().build();
    }
}
