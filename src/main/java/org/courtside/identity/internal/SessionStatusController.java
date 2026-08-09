package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiRole;
import org.courtside.api.ApiSessionStatus;
import org.courtside.api.SessionStatusApi;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class SessionStatusController implements SessionStatusApi {

    private final CurrentUser currentUser;

    @Override
    public ResponseEntity<ApiSessionStatus> getSessionStatus() {
        return ResponseEntity.ok(currentUser.account()
                .map(SessionStatusController::authenticated)
                .orElseGet(SessionStatusController::anonymous));
    }

    private static ApiSessionStatus authenticated(UserAccount account) {
        List<ApiRole> roles = account.getRoles().stream()
                .map(role -> ApiRole.valueOf(role.name()))
                .toList();
        return new ApiSessionStatus(true, roles, account.isPasswordChangeRequired())
                .username(account.getUsername())
                .displayName(account.getPerson().getDisplayName())
                .locale(account.getLocale());
    }

    private static ApiSessionStatus anonymous() {
        return new ApiSessionStatus(false, List.of(), false);
    }
}
