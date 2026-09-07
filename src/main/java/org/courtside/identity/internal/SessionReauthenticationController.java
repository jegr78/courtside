package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiReauthenticationRequest;
import org.courtside.api.SessionReauthenticationApi;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class SessionReauthenticationController implements SessionReauthenticationApi {

    private final ReauthenticationService reauthentication;

    @Override
    public ResponseEntity<Void> reauthenticate(ApiReauthenticationRequest request) {
        reauthentication.reauthenticate(request.getPassword());
        return ResponseEntity.noContent().build();
    }
}
