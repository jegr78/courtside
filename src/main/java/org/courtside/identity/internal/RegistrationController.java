package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.courtside.api.RegistrationApi;
import org.courtside.api.ApiRegistrationRequest;
import org.courtside.api.ApiRegistrationVerificationRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class RegistrationController implements RegistrationApi {

    private final RegistrationService registrations;
    private final HttpServletRequest request;

    @Override
    public ResponseEntity<Void> registerExternalAccount(ApiRegistrationRequest body) {
        registrations.register(new RegistrationService.Registration(body.getFirstName().strip(),
                body.getLastName().strip(), body.getUsername(), body.getPassword(), body.getEmail().strip(),
                body.getLanguage().getValue()), request.getRemoteAddr());
        return ResponseEntity.accepted().build();
    }

    @Override
    public ResponseEntity<Void> verifyRegistration(ApiRegistrationVerificationRequest body) {
        registrations.verify(body.getCode());
        return ResponseEntity.noContent().build();
    }
}
