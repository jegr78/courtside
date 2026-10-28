package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiMfaCodeProof;
import org.courtside.api.SessionMfaApi;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
class SessionMfaController implements SessionMfaApi {
    private final MfaLogin login;
    private final MfaSessionAuthentication authentication;
    private final HttpServletRequest request;
    private final HttpServletResponse response;

    @Override
    public ResponseEntity<Void> completeMfaLogin(ApiMfaCodeProof proof) {
        var current = SecurityContextHolder.getContext().getAuthentication();
        var session = request.getSession(false);
        if (!(current instanceof MfaPendingAuthentication pending) || session == null
                || !(session.getAttribute(MfaLogin.CHALLENGE) instanceof UUID challenge)) {
            throw new MfaProofFailedException();
        }
        MfaLogin.Result result = login.complete(pending, challenge, session.getId(), proof.getCode(), request.getRemoteAddr());
        if (result.limited()) throw new PasswordVerificationRateLimitedException();
        if (result.authentication() == null) throw new MfaProofFailedException();
        authentication.complete(result.authentication(), request, response);
        return ResponseEntity.ok().build();
    }
}
