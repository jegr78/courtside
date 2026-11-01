package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiWebAuthnAssertionCredential;
import org.courtside.api.ApiWebAuthnRequestOptions;
import org.courtside.api.SessionWebauthnApi;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
class SessionWebauthnController implements SessionWebauthnApi {
    private final MfaLogin login;
    private final MfaWebAuthnCodec codec;
    private final MfaSessionAuthentication authentication;
    private final HttpServletRequest request;
    private final HttpServletResponse response;

    @Override
    public ResponseEntity<ApiWebAuthnRequestOptions> beginWebauthnLogin() {
        var pending = pending();
        var session = request.getSession(false);
        var options = login.webAuthnOptions(pending, challenge(), session.getId());
        return ResponseEntity.ok(codec.toApi(options, ApiWebAuthnRequestOptions.class));
    }

    @Override
    public ResponseEntity<Void> completeWebauthnLogin(ApiWebAuthnAssertionCredential credential) {
        var result = login.completeWebAuthn(pending(), challenge(), request.getSession(false).getId(),
                codec.assertion(credential), request.getRemoteAddr());
        if (result.limit() != null) throw new SecondFactorRateLimitedException(result.limit());
        if (result.authentication() == null) throw new MfaProofFailedException();
        authentication.complete(result.authentication(), request, response);
        return ResponseEntity.ok().build();
    }

    private MfaPendingAuthentication pending() {
        if (SecurityContextHolder.getContext().getAuthentication() instanceof MfaPendingAuthentication pending) return pending;
        throw new MfaProofFailedException();
    }

    private UUID challenge() {
        var session = request.getSession(false);
        if (session != null && session.getAttribute(MfaLogin.CHALLENGE) instanceof UUID id) return id;
        throw new MfaProofFailedException();
    }
}
