package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import org.courtside.api.AccountApi;
import org.courtside.api.ApiInitialPasswordChangeRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class AccountController implements AccountApi {

    private final InitialPasswordService passwords;
    private final HttpServletRequest request;
    private final FindByIndexNameSessionRepository<? extends Session> sessions;

    @Override
    public ResponseEntity<Void> changeInitialPassword(ApiInitialPasswordChangeRequest change) {
        String username = request.getUserPrincipal().getName();
        passwords.change(change.getPassword());
        sessions.findByPrincipalName(username).keySet().forEach(sessions::deleteById);
        request.getSession(false).invalidate();
        return ResponseEntity.noContent().build();
    }
}
