package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import org.courtside.api.AccountApi;
import org.courtside.api.ApiInitialPasswordChangeRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class AccountController implements AccountApi {

    private final InitialPasswordService passwords;
    private final HttpServletRequest request;
    @Override
    public ResponseEntity<Void> changeInitialPassword(ApiInitialPasswordChangeRequest change) {
        passwords.change(change.getPassword());
        request.getSession(false).invalidate();
        return ResponseEntity.noContent().build();
    }
}
