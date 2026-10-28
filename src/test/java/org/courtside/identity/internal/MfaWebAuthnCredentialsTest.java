package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.dao.InvalidDataAccessApiUsageException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.web.webauthn.api.AuthenticatorSelectionCriteria;
import org.springframework.security.web.webauthn.api.ImmutableCredentialRecord;
import org.springframework.security.web.webauthn.api.Bytes;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRpEntity;
import org.springframework.security.web.webauthn.api.UserVerificationRequirement;
import org.springframework.security.web.webauthn.management.ImmutablePublicKeyCredentialCreationOptionsRequest;
import org.springframework.security.web.webauthn.management.ImmutablePublicKeyCredentialRequestOptionsRequest;
import org.springframework.security.web.webauthn.management.ImmutableRelyingPartyRegistrationRequest;
import org.springframework.security.web.webauthn.management.RelyingPartyAuthenticationRequest;
import org.springframework.security.web.webauthn.management.RelyingPartyPublicKey;
import org.springframework.security.web.webauthn.management.Webauthn4JRelyingPartyOperations;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.spy;

class MfaWebAuthnCredentialsTest extends AbstractIntegrationTest {
    private static final String ORIGIN = "https://courts.example.org";
    @Autowired private MfaWebAuthnUsers users;
    @Autowired private MfaWebAuthnCredentials credentials;
    @Autowired private JdbcClient jdbc;
    private Webauthn4JRelyingPartyOperations operations;
    private UUID account;

    @BeforeEach
    void setUp() {
        account = account("doe.jane");
        users.ensure(account);
        var rp = PublicKeyCredentialRpEntity.builder().id("courts.example.org").name("Example Tennis Club").build();
        operations = new Webauthn4JRelyingPartyOperations(users, credentials, rp, Set.of(ORIGIN));
        operations.setCustomizeCreationOptions(builder -> builder.authenticatorSelection(
                AuthenticatorSelectionCriteria.builder().userVerification(UserVerificationRequirement.REQUIRED).build()));
        operations.setCustomizeRequestOptions(builder -> builder.userVerification(UserVerificationRequirement.REQUIRED));
    }

    @Test
    void givenARealAuthenticator_whenRegisteringAndAuthenticating_thenNativeRecordsRoundTripThroughPostgres() {
        // given
        WebAuthnAuthenticatorFixture authenticator = register();
        var stored = credentials.findByCredentialId(authenticator.credentialId());
        assertThat(stored).isNotNull();
        // when
        var options = operations.createCredentialRequestOptions(new ImmutablePublicKeyCredentialRequestOptionsRequest(
                UsernamePasswordAuthenticationToken.authenticated("doe.jane", null, List.of())));
        var owner = operations.authenticate(new RelyingPartyAuthenticationRequest(options, authenticator.assertion(options, ORIGIN)));
        // then
        assertThat(owner.getId()).isEqualTo(users.ensure(account).getId());
        var updated = credentials.findByCredentialId(authenticator.credentialId());
        assertThat(updated.getSignatureCount()).isEqualTo(1);
        assertThat(updated.getPublicKey().getBytes()).isEqualTo(stored.getPublicKey().getBytes());
        assertThat(updated.isUvInitialized()).isTrue();
        assertThat(updated.getLabel()).isEqualTo("Private security key");
    }

    @Test
    void givenAnEnrolledCredential_whenAnotherAccountTriesToRebindItsId_thenOwnershipCannotChange() {
        // given
        WebAuthnAuthenticatorFixture authenticator = register();
        var stored = credentials.findByCredentialId(authenticator.credentialId());
        assertThat(stored).isNotNull();
        var other = users.ensure(account("roe.john"));
        var replacement = ImmutableCredentialRecord.fromCredentialRecord(stored).userEntityUserId(other.getId()).build();
        // when / then
        assertThatThrownBy(() -> credentials.save(replacement)).isInstanceOf(MfaProofFailedException.class);
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getUserEntityUserId())
                .isEqualTo(stored.getUserEntityUserId());
    }

    @Test
    void givenAnEnrolledCredential_whenRemovingItsWebAuthnIdentity_thenCredentialsDisappearButTheAccountRemains() {
        // given
        WebAuthnAuthenticatorFixture authenticator = register();
        assertThat(credentials.findByCredentialId(authenticator.credentialId())).isNotNull();
        // when
        users.delete(users.ensure(account).getId());
        // then
        assertThat(credentials.findByCredentialId(authenticator.credentialId())).isNull();
        assertThat(jdbc.sql("SELECT count(*) FROM user_account WHERE id = :id")
                .param("id", account).query(Integer.class).single()).isEqualTo(1);
    }

    @Test
    void givenTwoEnrolledKeys_whenRemovingOneTwice_thenTheOtherKeyAndAccountRemain() {
        // given
        var first = register();
        var second = register();
        // when
        credentials.delete(first.credentialId());
        credentials.delete(first.credentialId());
        credentials.delete(null);
        // then
        assertThat(credentials.findByCredentialId(first.credentialId())).isNull();
        assertThat(credentials.findByCredentialId(second.credentialId()).getUserEntityUserId())
                .isEqualTo(users.ensure(account).getId());
        assertThat(credentials.findByCredentialId(null)).isNull();
        assertThat(credentials.findByUserId(null)).isEmpty();
        assertThat(credentials.findByUserId(users.ensure(account).getId())).hasSize(1);
        assertThat(jdbc.sql("SELECT count(*) FROM user_account WHERE id = :id")
                .param("id", account).query(Integer.class).single()).isEqualTo(1);
    }

    @Test
    void givenIncompleteCredentialBindings_whenSaving_thenNoNativeRecordCanBeRebound() {
        // given
        var key = register();
        var original = credentials.findByCredentialId(key.credentialId());
        var noId = spy(original);
        doReturn(null).when(noId).getCredentialId();
        var noOwner = spy(original);
        doReturn(null).when(noOwner).getUserEntityUserId();
        // when / then
        for (var invalid : new org.springframework.security.web.webauthn.api.CredentialRecord[]{null, noId, noOwner}) {
            assertThatThrownBy(() -> credentials.save(invalid)).isInstanceOf(InvalidDataAccessApiUsageException.class)
                    .hasCauseInstanceOf(IllegalStateException.class).hasMessage("WebAuthn credential binding is required");
        }
        for (Bytes owner : new Bytes[]{new Bytes(new byte[15]), MfaWebAuthnUsers.handle(UUID.randomUUID()),
                MfaWebAuthnUsers.handle(account("roe.john"))}) {
            var invalid = ImmutableCredentialRecord.fromCredentialRecord(original).credentialId(Bytes.random())
                    .userEntityUserId(owner).build();
            assertThatThrownBy(() -> credentials.save(invalid)).isInstanceOf(MfaProofFailedException.class);
        }
        assertThat(credentials.findByCredentialId(key.credentialId()).getUserEntityUserId())
                .isEqualTo(original.getUserEntityUserId());
        assertThat(jdbc.sql("SELECT count(*) FROM user_credentials").query(Long.class).single()).isEqualTo(1);
    }

    private WebAuthnAuthenticatorFixture register() {
        var authenticator = new WebAuthnAuthenticatorFixture();
        var options = operations.createPublicKeyCredentialCreationOptions(new ImmutablePublicKeyCredentialCreationOptionsRequest(
                UsernamePasswordAuthenticationToken.authenticated("doe.jane", null, List.of())));
        operations.registerCredential(new ImmutableRelyingPartyRegistrationRequest(options,
                new RelyingPartyPublicKey(authenticator.register(options, ORIGIN), "Private security key")));
        return authenticator;
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
