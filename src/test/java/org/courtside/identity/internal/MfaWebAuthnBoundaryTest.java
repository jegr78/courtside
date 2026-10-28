package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.web.webauthn.api.AttestationConveyancePreference;
import org.springframework.security.web.webauthn.api.AuthenticatorTransport;
import org.springframework.security.web.webauthn.api.Bytes;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialDescriptor;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialParameters;
import org.springframework.test.context.TestPropertySource;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.time.Clock;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.spy;

@TestPropertySource(properties = "courtside.public-url=https://courts.example.org")
class MfaWebAuthnBoundaryTest extends AbstractIntegrationTest {
    private static final String ORIGIN = "https://courts.example.org";
    @Autowired private MfaWebAuthn webAuthn;
    @Autowired private MfaWebAuthnUsers users;
    @Autowired private MfaWebAuthnCredentials credentials;
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;

    @ParameterizedTest
    @ValueSource(strings = {"null-account", "missing-account", "null-label", "null-credential", "null-raw-id",
            "null-response", "null-client-data", "mismatched-id", "null-type", "null-options", "null-challenge",
            "null-parameters", "empty-parameters", "null-parameter", "null-algorithm", "null-parameter-type",
            "null-rp", "null-user", "foreign-user", "null-selection", "direct-attestation", "null-attestation",
            "null-attestation-object", "null-transport", "null-cbor-attestation", "empty-cbor-map"})
    void givenIncompleteRegistrationMaterial_whenRegistering_thenNoCredentialCanBeStored(String invalid) {
        // given
        UUID account = account("doe.jane");
        var options = spy(webAuthn.registrationOptions(account));
        var authenticator = new WebAuthnAuthenticatorFixture();
        var credential = spy(authenticator.register(options, ORIGIN));
        var response = spy(credential.getResponse());
        doReturn(response).when(credential).getResponse();
        String label = "Private key";
        switch (invalid) {
            case "null-account" -> account = null;
            case "missing-account" -> account = UUID.randomUUID();
            case "null-label" -> label = null;
            case "null-credential" -> credential = null;
            case "null-raw-id" -> doReturn(null).when(credential).getRawId();
            case "null-response" -> doReturn(null).when(credential).getResponse();
            case "null-client-data" -> doReturn(null).when(response).getClientDataJSON();
            case "mismatched-id" -> doReturn("different-id").when(credential).getId();
            case "null-type" -> doReturn(null).when(credential).getType();
            case "null-options" -> options = null;
            case "null-challenge" -> doReturn(null).when(options).getChallenge();
            case "null-parameters" -> doReturn(null).when(options).getPubKeyCredParams();
            case "empty-parameters" -> doReturn(List.of()).when(options).getPubKeyCredParams();
            case "null-parameter" -> doReturn(Arrays.asList((PublicKeyCredentialParameters) null)).when(options).getPubKeyCredParams();
            case "null-algorithm", "null-parameter-type" -> {
                var parameter = spy(PublicKeyCredentialParameters.ES256);
                if (invalid.equals("null-algorithm")) doReturn(null).when(parameter).getAlg();
                else doReturn(null).when(parameter).getType();
                doReturn(List.of(parameter)).when(options).getPubKeyCredParams();
            }
            case "null-rp" -> doReturn(null).when(options).getRp();
            case "null-user" -> doReturn(null).when(options).getUser();
            case "foreign-user" -> doReturn(users.ensure(account("roe.john"))).when(options).getUser();
            case "null-selection" -> doReturn(null).when(options).getAuthenticatorSelection();
            case "direct-attestation" -> doReturn(AttestationConveyancePreference.DIRECT).when(options).getAttestation();
            case "null-attestation" -> doReturn(null).when(options).getAttestation();
            case "null-attestation-object" -> doReturn(null).when(response).getAttestationObject();
            case "null-transport" -> doReturn(Arrays.asList((AuthenticatorTransport) null)).when(response).getTransports();
            case "null-cbor-attestation" -> doReturn(new Bytes(new byte[]{(byte) 0xf6})).when(response).getAttestationObject();
            case "empty-cbor-map" -> doReturn(new Bytes(new byte[]{(byte) 0xa0})).when(response).getAttestationObject();
            default -> throw new AssertionError(invalid);
        }

        // when / then
        assertThat(webAuthn.register(account, options, credential, label)).isFalse();
        assertThat(jdbc.sql("SELECT count(*) FROM user_credentials").query(Long.class).single()).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"null-options", "null-challenge", "null-allow-list", "null-descriptor",
            "null-descriptor-id", "null-verification", "null-signature", "null-authenticator-data", "foreign-identity"})
    void givenIncompleteAssertionMaterial_whenVerifying_thenThePersistedOwnerAndCounterStayUnchanged(String invalid) {
        // given
        UUID account = account("doe.jane");
        var authenticator = new WebAuthnAuthenticatorFixture();
        var creation = webAuthn.registrationOptions(account);
        assertThat(webAuthn.register(account, creation, authenticator.register(creation, ORIGIN), "Private key")).isTrue();
        var options = spy(webAuthn.authenticationOptions(account));
        var assertion = spy(authenticator.assertion(options, ORIGIN));
        var response = spy(assertion.getResponse());
        doReturn(response).when(assertion).getResponse();
        switch (invalid) {
            case "null-options" -> options = null;
            case "null-challenge" -> doReturn(null).when(options).getChallenge();
            case "null-allow-list" -> doReturn(null).when(options).getAllowCredentials();
            case "null-descriptor" -> doReturn(Arrays.asList((PublicKeyCredentialDescriptor) null)).when(options).getAllowCredentials();
            case "null-descriptor-id" -> {
                var descriptor = spy(options.getAllowCredentials().getFirst());
                doReturn(null).when(descriptor).getId();
                doReturn(List.of(descriptor)).when(options).getAllowCredentials();
            }
            case "null-verification" -> doReturn(null).when(options).getUserVerification();
            case "null-signature" -> doReturn(null).when(response).getSignature();
            case "null-authenticator-data" -> doReturn(null).when(response).getAuthenticatorData();
            case "foreign-identity" -> jdbc.sql("UPDATE user_entities SET account_id = :other WHERE account_id = :owner")
                    .param("other", account("roe.john")).param("owner", account).update();
            default -> throw new AssertionError(invalid);
        }

        // when / then
        assertThat(webAuthn.verify(account, options, assertion)).isFalse();
        var stored = credentials.findByCredentialId(authenticator.credentialId());
        assertThat(stored.getSignatureCount()).isZero();
        assertThat(stored.getLabel()).isEqualTo("Private key");
        assertThat(MfaWebAuthnUsers.account(stored.getUserEntityUserId())).contains(account);
    }

    @ParameterizedTest
    @ValueSource(strings = {"transports", "user-handle"})
    void givenAnAbsentOptionalAuthenticatorHint_whenTheSignedProofIsValid_thenTheCredentialStillAuthenticates(String absent) {
        // given
        UUID account = account("doe.jane");
        var authenticator = new WebAuthnAuthenticatorFixture();
        var creation = webAuthn.registrationOptions(account);
        var registration = spy(authenticator.register(creation, ORIGIN));
        var attestation = spy(registration.getResponse());
        if (absent.equals("transports")) doReturn(null).when(attestation).getTransports();
        doReturn(attestation).when(registration).getResponse();

        // when
        assertThat(webAuthn.register(account, creation, registration, "Private key")).isTrue();
        var options = webAuthn.authenticationOptions(account);
        var assertion = spy(authenticator.assertion(options, ORIGIN));
        var response = spy(assertion.getResponse());
        if (absent.equals("user-handle")) doReturn(null).when(response).getUserHandle();
        doReturn(response).when(assertion).getResponse();

        // then
        assertThat(webAuthn.verify(account, options, assertion)).isTrue();
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void givenATemporaryPasswordThatHasNotExpired_whenTheEnrolledKeySigns_thenMfaProofPreservesTheRequiredPasswordChange(
            boolean expiring) {
        // given
        UUID account = account("doe.jane");
        var authenticator = new WebAuthnAuthenticatorFixture();
        var creation = webAuthn.registrationOptions(account);
        assertThat(webAuthn.register(account, creation, authenticator.register(creation, ORIGIN), "Private key")).isTrue();
        jdbc.sql("UPDATE user_account SET password_change_required = true, credentials_expire_at = :expiry WHERE id = :id")
                .param("expiry", expiring ? clock.instant().plusSeconds(300).atOffset(ZoneOffset.UTC) : null)
                .param("id", account).update();

        // when
        var options = webAuthn.authenticationOptions(account);
        boolean accepted = webAuthn.verify(account, options, authenticator.assertion(options, ORIGIN));

        // then
        assertThat(accepted).isTrue();
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isEqualTo(1);
        assertThat(jdbc.sql("SELECT password_change_required FROM user_account WHERE id = :id")
                .param("id", account).query(Boolean.class).single()).isTrue();
    }

    private UUID account(String username) {
        UUID id = UUID.randomUUID();
        jdbc.sql("INSERT INTO person (id, first_name, last_name, email) VALUES (:id, 'Jane', 'Doe', :email)")
                .param("id", id).param("email", id + "@example.org").update();
        jdbc.sql("""
                INSERT INTO user_account (id, person_id, username, locale, enabled, password_change_required)
                VALUES (:id, :id, :username, 'en', true, false)
                """).param("id", id).param("username", username).update();
        return id;
    }
}
