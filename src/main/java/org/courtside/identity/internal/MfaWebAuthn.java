package org.courtside.identity.internal;

import com.webauthn4j.converter.exception.DataConversionException;
import com.webauthn4j.converter.util.ObjectConverter;
import com.webauthn4j.data.attestation.AttestationObject;
import com.webauthn4j.verifier.exception.VerificationException;
import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.shared.InstanceAddress;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.web.webauthn.api.AttestationConveyancePreference;
import org.springframework.security.web.webauthn.api.AuthenticatorAssertionResponse;
import org.springframework.security.web.webauthn.api.AuthenticatorAttestationResponse;
import org.springframework.security.web.webauthn.api.AuthenticatorResponse;
import org.springframework.security.web.webauthn.api.AuthenticatorSelectionCriteria;
import org.springframework.security.web.webauthn.api.PublicKeyCredential;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialCreationOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRequestOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRpEntity;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialType;
import org.springframework.security.web.webauthn.api.ResidentKeyRequirement;
import org.springframework.security.web.webauthn.api.UserVerificationRequirement;
import org.springframework.security.web.webauthn.management.ImmutablePublicKeyCredentialCreationOptionsRequest;
import org.springframework.security.web.webauthn.management.ImmutablePublicKeyCredentialRequestOptionsRequest;
import org.springframework.security.web.webauthn.management.ImmutableRelyingPartyRegistrationRequest;
import org.springframework.security.web.webauthn.management.RelyingPartyAuthenticationRequest;
import org.springframework.security.web.webauthn.management.RelyingPartyPublicKey;
import org.springframework.security.web.webauthn.management.Webauthn4JRelyingPartyOperations;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;

import java.net.URI;
import java.nio.ByteBuffer;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
class MfaWebAuthn {
    private final InstanceAddress address;
    private final ClubIdentity club;
    private final MfaWebAuthnUsers users;
    private final MfaWebAuthnCredentials credentials;
    private final JdbcClient jdbc;
    private final Clock clock;
    private final ObjectConverter converter = new ObjectConverter();

    boolean available() {
        return address.relyingPartyId().isPresent();
    }

    @Transactional
    PublicKeyCredentialCreationOptions registrationOptions(UUID account) {
        URI origin = origin();
        String username = lockEligibleAccount(account).orElseThrow(MfaProofFailedException::new);
        users.ensure(account);
        return operations(origin).createPublicKeyCredentialCreationOptions(
                new ImmutablePublicKeyCredentialCreationOptionsRequest(principal(username)));
    }

    @Transactional
    PublicKeyCredentialRequestOptions authenticationOptions(UUID account) {
        URI origin = origin();
        String username = lockEligibleAccount(account).orElseThrow(MfaProofFailedException::new);
        if (!credentials.enabled(account)) throw new MfaProofFailedException();
        return operations(origin).createCredentialRequestOptions(
                new ImmutablePublicKeyCredentialRequestOptionsRequest(principal(username)));
    }

    @Transactional
    boolean register(UUID account, PublicKeyCredentialCreationOptions options,
            PublicKeyCredential<AuthenticatorAttestationResponse> credential, String label) {
        URI origin = origin();
        if (lockEligibleAccount(account).isEmpty() || !validLabel(label) || !validCredential(credential)
                || !registrationPolicy(account, options, origin)
                || credential.getResponse().getAttestationObject() == null
                || (credential.getResponse().getTransports() != null
                    && credential.getResponse().getTransports().stream().anyMatch(java.util.Objects::isNull))
                || credentials.findByCredentialId(credential.getRawId()) != null) return false;
        try {
            var attestation = converter.getCborMapper().readValue(
                    credential.getResponse().getAttestationObject().getBytes(), AttestationObject.class);
            if (attestation == null || attestation.getAuthenticatorData() == null
                    || attestation.getAuthenticatorData().getAttestedCredentialData() == null
                    || !Arrays.equals(credential.getRawId().getBytes(), attestation.getAuthenticatorData()
                            .getAttestedCredentialData().getCredentialId())) return false;
            operations(origin).registerCredential(new ImmutableRelyingPartyRegistrationRequest(options,
                    new RelyingPartyPublicKey(credential, label)));
            return true;
        } catch (VerificationException | DataConversionException | JacksonException | IllegalArgumentException invalid) {
            return false;
        }
    }

    @Transactional
    boolean verify(UUID account, PublicKeyCredentialRequestOptions options,
            PublicKeyCredential<AuthenticatorAssertionResponse> credential) {
        URI origin = origin();
        if (lockEligibleAccount(account).isEmpty() || !validCredential(credential)
                || options == null || !origin.getHost().equals(options.getRpId())
                || options.getChallenge() == null || options.getAllowCredentials() == null
                || options.getAllowCredentials().stream().anyMatch(value -> value == null || value.getId() == null)
                || !UserVerificationRequirement.REQUIRED.equals(options.getUserVerification())) return false;
        var stored = credentials.findByCredentialId(credential.getRawId());
        if (stored == null || !MfaWebAuthnUsers.account(stored.getUserEntityUserId()).filter(account::equals).isPresent()
                || users.findById(stored.getUserEntityUserId()) == null) return false;
        var response = credential.getResponse();
        if (response.getUserHandle() != null && !response.getUserHandle().equals(stored.getUserEntityUserId())) return false;
        if (response.getSignature() == null || response.getAuthenticatorData() == null
                || response.getAuthenticatorData().getBytes().length < 37) return false;
        long counter = Integer.toUnsignedLong(ByteBuffer.wrap(response.getAuthenticatorData().getBytes(), 33, 4).getInt());
        if ((counter > 0 || stored.getSignatureCount() > 0) && counter <= stored.getSignatureCount()) return false;
        try {
            operations(origin).authenticate(new RelyingPartyAuthenticationRequest(options, credential));
            return true;
        } catch (VerificationException | DataConversionException | IllegalArgumentException invalid) {
            return false;
        }
    }

    private boolean registrationPolicy(UUID account, PublicKeyCredentialCreationOptions options, URI origin) {
        return options != null && options.getChallenge() != null && options.getPubKeyCredParams() != null
                && !options.getPubKeyCredParams().isEmpty() && options.getPubKeyCredParams().stream()
                        .allMatch(value -> value != null && value.getAlg() != null
                                && PublicKeyCredentialType.PUBLIC_KEY.equals(value.getType()))
                && options.getRp() != null && origin.getHost().equals(options.getRp().getId())
                && options.getUser() != null && MfaWebAuthnUsers.account(options.getUser().getId()).filter(account::equals).isPresent()
                && options.getAuthenticatorSelection() != null && UserVerificationRequirement.REQUIRED.equals(
                        options.getAuthenticatorSelection().getUserVerification())
                && AttestationConveyancePreference.NONE.equals(options.getAttestation());
    }

    private Optional<String> lockEligibleAccount(UUID account) {
        if (account == null) return Optional.empty();
        return jdbc.sql("""
                SELECT account.username, account.enabled, account.password_change_required, account.credentials_expire_at,
                    EXISTS (SELECT 1 FROM account_mfa WHERE account_id = account.id AND recovery_pending) AS recovery_pending
                FROM user_account account WHERE account.id = :id FOR UPDATE
                """).param("id", account).query((result, row) -> {
                    OffsetDateTime expires = result.getObject("credentials_expire_at", OffsetDateTime.class);
                    boolean expired = result.getBoolean("password_change_required") && expires != null
                            && !clock.instant().isBefore(expires.toInstant());
                    return result.getBoolean("enabled") && !result.getBoolean("recovery_pending") && !expired
                            ? Optional.of(result.getString("username")) : Optional.<String>empty();
                }).optional().orElseGet(Optional::empty);
    }

    private Webauthn4JRelyingPartyOperations operations(URI origin) {
        var rp = PublicKeyCredentialRpEntity.builder().id(origin.getHost()).name(club.clubName()).build();
        var operations = new Webauthn4JRelyingPartyOperations(users, credentials, rp, Set.of(origin.toString()));
        operations.setCustomizeCreationOptions(builder -> builder.attestation(AttestationConveyancePreference.NONE)
                .authenticatorSelection(AuthenticatorSelectionCriteria.builder().residentKey(ResidentKeyRequirement.PREFERRED)
                        .userVerification(UserVerificationRequirement.REQUIRED).build()));
        operations.setCustomizeRequestOptions(builder -> builder.userVerification(UserVerificationRequirement.REQUIRED));
        return operations;
    }

    private URI origin() {
        return address.relyingPartyId().flatMap(id -> address.origin()).orElseThrow(MfaProofFailedException::new);
    }

    private static UsernamePasswordAuthenticationToken principal(String username) {
        return UsernamePasswordAuthenticationToken.authenticated(username, null, List.of());
    }

    private static boolean validLabel(String label) {
        return label != null && !label.isBlank() && label.length() <= 100
                && label.codePoints().noneMatch(Character::isISOControl);
    }

    private static boolean validCredential(PublicKeyCredential<? extends AuthenticatorResponse> credential) {
        return credential != null && credential.getRawId() != null && credential.getResponse() != null
                && credential.getResponse().getClientDataJSON() != null
                && credential.getRawId().toBase64UrlString().equals(credential.getId())
                && PublicKeyCredentialType.PUBLIC_KEY.equals(credential.getType());
    }
}
