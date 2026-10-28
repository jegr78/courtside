package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.ClubIdentity;
import org.courtside.shared.InstanceAddress;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.web.webauthn.api.AuthenticatorAssertionResponse;
import org.springframework.security.web.webauthn.api.AuthenticatorSelectionCriteria;
import org.springframework.security.web.webauthn.api.Bytes;
import org.springframework.security.web.webauthn.api.PublicKeyCredential;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialCreationOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRequestOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRpEntity;
import org.springframework.security.web.webauthn.api.ResidentKeyRequirement;
import org.springframework.security.web.webauthn.api.UserVerificationRequirement;
import org.springframework.test.context.TestPropertySource;

import java.time.Clock;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@TestPropertySource(properties = "courtside.public-url=https://courts.example.org:8443")
class MfaWebAuthnTest extends AbstractIntegrationTest {
    private static final String ORIGIN = "https://courts.example.org:8443";
    private static final String RP_ID = "courts.example.org";
    @Autowired private MfaWebAuthn webAuthn;
    @Autowired private MfaWebAuthnCodec codec;
    @Autowired private MfaWebAuthnUsers users;
    @Autowired private MfaWebAuthnCredentials credentials;
    @Autowired private ClubIdentity club;
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;

    @Test
    void givenAnAccountWithoutTotp_whenRegisteringMultipleKeys_thenEitherPrivateCredentialAuthenticatesItsOwner() {
        // given
        UUID account = account("doe.jane");
        var first = register(account, "Private security key");
        var second = register(account, "Private platform authenticator");
        var options = roundTrip(webAuthn.authenticationOptions(account));
        // when / then
        assertThat(webAuthn.available()).isTrue();
        assertThat(credentials.enabled(account)).isTrue();
        assertThat(webAuthn.verify(account, options, first.assertion(options, ORIGIN))).isTrue();
        assertThat(webAuthn.verify(account, options, second.assertion(options, ORIGIN))).isTrue();
        assertThat(credentials.findByUserId(users.ensure(account).getId()))
                .extracting(record -> record.getLabel()).containsExactlyInAnyOrder(
                        "Private security key", "Private platform authenticator");
        assertThat(jdbc.sql("SELECT count(*) FROM account_mfa WHERE account_id = :id AND totp_secret IS NOT NULL")
                .param("id", account).query(Integer.class).single()).isZero();
    }

    @Test
    void givenTwoIndependentAccounts_whenEachUsesItsOwnCredential_thenTheirHandlesAndCountersStaySeparate() {
        // given
        UUID first = account("doe.jane");
        UUID second = account("roe.john");
        var firstAuthenticator = register(first, "First private key");
        var secondAuthenticator = register(second, "Second private key");
        var firstOptions = webAuthn.authenticationOptions(first);
        var secondOptions = webAuthn.authenticationOptions(second);
        // when / then
        assertThat(webAuthn.verify(first, firstOptions, firstAuthenticator.assertion(firstOptions, ORIGIN))).isTrue();
        assertThat(webAuthn.verify(second, secondOptions, secondAuthenticator.assertion(secondOptions, ORIGIN))).isTrue();
        assertThat(firstOptions.getAllowCredentials()).extracting(value -> value.getId())
                .containsExactly(firstAuthenticator.credentialId());
        assertThat(secondOptions.getAllowCredentials()).extracting(value -> value.getId())
                .containsExactly(secondAuthenticator.credentialId());
        assertThat(users.ensure(first).getId()).isNotEqualTo(users.ensure(second).getId());
    }

    @Test
    void givenAnAccountWithoutAWebAuthnCredential_whenRequestingAssertionOptions_thenProofFailsBeforeAnAccountPickerCanOpen() {
        // given
        UUID account = account("doe.jane");
        users.ensure(account);
        // when / then
        assertThatThrownBy(() -> webAuthn.authenticationOptions(account)).isInstanceOf(MfaProofFailedException.class);
        assertThat(credentials.enabled(account)).isFalse();
    }

    @Test
    void givenSerializedOptions_whenCreatingAnAuthenticator_thenVerificationAndDomainPolicyStayRequired() {
        // given
        UUID account = account("doe.jane");
        // when
        var creation = roundTrip(webAuthn.registrationOptions(account));
        // then
        assertThat(creation.getAuthenticatorSelection().getUserVerification()).isEqualTo(UserVerificationRequirement.REQUIRED);
        assertThat(creation.getAuthenticatorSelection().getResidentKey()).isEqualTo(ResidentKeyRequirement.PREFERRED);
        assertThat(creation.getRp().getId()).isEqualTo(RP_ID);
        var authenticator = new WebAuthnAuthenticatorFixture();
        assertThat(webAuthn.register(account, creation,
                authenticator.register(creation, ORIGIN, false, RP_ID, 0), "Key")).isFalse();
        assertThat(credentials.enabled(account)).isFalse();
        assertThat(webAuthn.register(account, creation, authenticator.register(creation, ORIGIN), "Key")).isTrue();
        var request = roundTrip(webAuthn.authenticationOptions(account));
        assertThat(request.getRpId()).isEqualTo(RP_ID);
        assertThat(request.getUserVerification()).isEqualTo(UserVerificationRequirement.REQUIRED);
    }

    @ParameterizedTest
    @ValueSource(strings = {"uv", "origin", "rp", "challenge", "attested-id", "downgraded-options", "wrong-account-options", "changed-rp-options"})
    void givenInvalidRegistrationProof_whenRegistering_thenNoCredentialIsPersisted(String invalid) {
        // given
        UUID account = account("doe.jane");
        var options = roundTrip(webAuthn.registrationOptions(account));
        var authenticator = new WebAuthnAuthenticatorFixture();
        if (invalid.equals("changed-rp-options")) options = creationOptions(options, true, "other.example.org");
        var inputOptions = invalid.equals("wrong-account-options")
                ? webAuthn.registrationOptions(account("roe.john")) : options;
        var credential = authenticator.register(inputOptions,
                invalid.equals("origin") ? "https://other.example.org" : ORIGIN,
                !invalid.equals("uv"), invalid.equals("rp") || invalid.equals("changed-rp-options") ? "other.example.org" : RP_ID, 0);
        if (invalid.equals("challenge")) options = webAuthn.registrationOptions(account);
        if (invalid.equals("downgraded-options")) options = creationOptions(options, false, RP_ID);
        if (invalid.equals("attested-id")) {
            var builder = PublicKeyCredential.<org.springframework.security.web.webauthn.api.AuthenticatorAttestationResponse>builder();
            var id = Bytes.random();
            builder.id(id.toBase64UrlString());
            builder.rawId(id);
            builder.type(credential.getType());
            builder.response(credential.getResponse());
            credential = builder.build();
        }
        // when / then
        assertThat(webAuthn.register(account, options, credential, "Key")).isFalse();
        assertThat(credentials.enabled(account)).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"uv", "origin", "rp", "signature", "challenge", "user-handle", "malformed", "unknown", "other-owner", "downgraded-options", "changed-rp"})
    void givenAnInvalidSignedAssertion_whenVerifying_thenTheStoredCounterAndOwnerStayUnchanged(String invalid) {
        // given
        UUID account = account("doe.jane");
        var authenticator = register(account, "Key");
        var options = roundTrip(webAuthn.authenticationOptions(account));
        var assertion = authenticator.assertion(options,
                invalid.equals("origin") ? "https://other.example.org" : ORIGIN,
                !invalid.equals("uv"), invalid.equals("rp") ? "other.example.org" : RP_ID,
                1, invalid.equals("signature"));
        if (invalid.equals("challenge")) options = webAuthn.authenticationOptions(account);
        if (invalid.equals("downgraded-options")) options = requestOptions(options, false, RP_ID);
        if (invalid.equals("changed-rp")) options = requestOptions(options, true, "other.example.org");
        if (invalid.equals("user-handle")) assertion = response(assertion, assertion.getResponse().getAuthenticatorData(), Bytes.random());
        if (invalid.equals("malformed")) assertion = response(assertion, new Bytes(new byte[36]), assertion.getResponse().getUserHandle());
        if (invalid.equals("unknown")) {
            var unknown = new WebAuthnAuthenticatorFixture();
            unknown.register(webAuthn.registrationOptions(account), ORIGIN);
            assertion = unknown.assertion(options, ORIGIN);
        }
        UUID verifiedAccount = invalid.equals("other-owner") ? account("roe.john") : account;
        // when / then
        assertThat(webAuthn.verify(verifiedAccount, options, assertion)).isFalse();
        var stored = credentials.findByCredentialId(authenticator.credentialId());
        assertThat(stored.getSignatureCount()).isZero();
        assertThat(MfaWebAuthnUsers.account(stored.getUserEntityUserId())).contains(account);
    }

    @Test
    void givenAnAdvancingCounter_whenReusingOrRegressingIt_thenOnlyIncreasingSignedAssertionsSucceed() {
        // given
        UUID account = account("doe.jane");
        var authenticator = register(account, "Key");
        var options = roundTrip(webAuthn.authenticationOptions(account));
        // when / then
        assertThat(webAuthn.verify(account, options, authenticator.assertion(options, ORIGIN, true, RP_ID, 1, false))).isTrue();
        assertThat(webAuthn.verify(account, options, authenticator.assertion(options, ORIGIN, true, RP_ID, 2, false))).isTrue();
        assertThat(webAuthn.verify(account, options, authenticator.assertion(options, ORIGIN, true, RP_ID, 2, false))).isFalse();
        assertThat(webAuthn.verify(account, options, authenticator.assertion(options, ORIGIN, true, RP_ID, 1, false))).isFalse();
        assertThat(webAuthn.verify(account, options, authenticator.assertion(options, ORIGIN, true, RP_ID, 0, false))).isFalse();
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isEqualTo(2);
    }

    @Test
    void givenUnsignedAuthenticatorCounters_whenTheHighBitIsSet_thenIncreasingValuesStillAuthenticate() {
        // given
        UUID account = account("doe.jane");
        var authenticator = register(account, "Key");
        var options = webAuthn.authenticationOptions(account);
        // when / then
        assertThat(webAuthn.verify(account, options,
                authenticator.assertion(options, ORIGIN, true, RP_ID, 0x80000000L, false))).isTrue();
        assertThat(webAuthn.verify(account, options,
                authenticator.assertion(options, ORIGIN, true, RP_ID, 0xffffffffL, false))).isTrue();
        assertThat(webAuthn.verify(account, options,
                authenticator.assertion(options, ORIGIN, true, RP_ID, 0xfffffffeL, false))).isFalse();
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isEqualTo(0xffffffffL);
    }

    @Test
    void givenAnAuthenticatorWithoutACounter_whenItSignsZeroRepeatedly_thenVerificationRemainsAvailable() {
        // given
        UUID account = account("doe.jane");
        var authenticator = register(account, "Key");
        var options = roundTrip(webAuthn.authenticationOptions(account));
        // when / then
        assertThat(webAuthn.verify(account, options, authenticator.assertion(options, ORIGIN, true, RP_ID, 0, false))).isTrue();
        assertThat(webAuthn.verify(account, options, authenticator.assertion(options, ORIGIN, true, RP_ID, 0, false))).isTrue();
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"disabled", "recovery-pending", "expired"})
    void givenAnAccountThatCannotSignIn_whenPresentingAValidCredential_thenVerificationIsRefused(String state) {
        // given
        UUID account = account("doe.jane");
        var authenticator = register(account, "Key");
        var options = roundTrip(webAuthn.authenticationOptions(account));
        switch (state) {
            case "disabled" -> jdbc.sql("UPDATE user_account SET enabled = false WHERE id = :id").param("id", account).update();
            case "expired" -> jdbc.sql("UPDATE user_account SET password_change_required = true, credentials_expire_at = :expiry WHERE id = :id")
                    .param("id", account).param("expiry", clock.instant().atOffset(java.time.ZoneOffset.UTC)).update();
            case "recovery-pending" -> jdbc.sql("INSERT INTO account_mfa (account_id, recovery_pending) VALUES (:id, true)")
                    .param("id", account).update();
            default -> throw new AssertionError(state);
        }
        // when / then
        assertThat(webAuthn.verify(account, options, authenticator.assertion(options, ORIGIN))).isFalse();
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getSignatureCount()).isZero();
        assertThatThrownBy(() -> webAuthn.registrationOptions(account)).isInstanceOf(MfaProofFailedException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", " ", "line\nbreak", "control\u007f", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})
    void givenAnInvalidPrivateLabel_whenRegistering_thenNoCredentialIsPersisted(String label) {
        // given
        UUID account = account("doe.jane");
        var options = webAuthn.registrationOptions(account);
        var authenticator = new WebAuthnAuthenticatorFixture();
        // when / then
        assertThat(webAuthn.register(account, options, authenticator.register(options, ORIGIN), label)).isFalse();
        assertThat(credentials.enabled(account)).isFalse();
    }

    @Test
    void givenAnExistingCredential_whenAnotherRegistrationUsesItsId_thenItCannotReplaceTheOwnerOrLabel() {
        // given
        UUID account = account("doe.jane");
        var authenticator = register(account, "Original key");
        var options = webAuthn.registrationOptions(account);
        // when / then
        assertThat(webAuthn.register(account, options, authenticator.register(options, ORIGIN), "Replacement")).isFalse();
        assertThat(credentials.findByCredentialId(authenticator.credentialId()).getLabel()).isEqualTo("Original key");
    }

    @Test
    void givenNoTrustedDeploymentAddress_whenWebAuthnIsRequested_thenItIsUnavailableAndProofFailsGenerically() {
        // given
        var unavailable = new MfaWebAuthn(new InstanceAddress(""), club, users, credentials, jdbc, clock);
        // when / then
        assertThat(unavailable.available()).isFalse();
        assertThatThrownBy(() -> unavailable.registrationOptions(UUID.randomUUID())).isInstanceOf(MfaProofFailedException.class);
        assertThatThrownBy(() -> unavailable.authenticationOptions(UUID.randomUUID())).isInstanceOf(MfaProofFailedException.class);
        assertThatThrownBy(() -> unavailable.register(UUID.randomUUID(), null, null, "Key")).isInstanceOf(MfaProofFailedException.class);
        assertThatThrownBy(() -> unavailable.verify(UUID.randomUUID(), null, null)).isInstanceOf(MfaProofFailedException.class);
    }

    @Test
    void givenNineteenCredentials_whenRegisteringTheTwentiethAndATwentyFirst_thenOnlyTheTwentiethIsStored() {
        // given
        UUID account = account("doe.jane");
        for (int index = 1; index < MfaWebAuthn.CREDENTIAL_LIMIT; index++) register(account, "Key " + index);
        var lateOptions = roundTrip(webAuthn.registrationOptions(account));
        // when
        register(account, "Key " + MfaWebAuthn.CREDENTIAL_LIMIT);
        // then
        assertThatThrownBy(() -> webAuthn.registrationOptions(account))
                .isInstanceOf(WebAuthnCredentialLimitException.class);
        var late = new WebAuthnAuthenticatorFixture();
        assertThatThrownBy(() -> webAuthn.register(account, lateOptions, late.register(lateOptions, ORIGIN), "Late key"))
                .isInstanceOf(WebAuthnCredentialLimitException.class);
        assertThat(credentials.findByUserId(users.ensure(account).getId()))
                .as("an account holds at most %s WebAuthn credentials", MfaWebAuthn.CREDENTIAL_LIMIT)
                .hasSize(MfaWebAuthn.CREDENTIAL_LIMIT);
        assertThat(credentials.findByCredentialId(late.credentialId())).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"https://192.0.2.10", "https://[2001:db8::1]:8443"})
    void givenAnIpAddressDeployment_whenWebAuthnIsRequested_thenItIsUnavailableAndProofFailsGenerically(String configured) {
        // given
        var unavailable = new MfaWebAuthn(new InstanceAddress(configured), club, users, credentials, jdbc, clock);
        UUID account = account("doe.jane");
        // when / then
        assertThat(unavailable.available()).as("browsers refuse an IP address as relying-party id").isFalse();
        assertThatThrownBy(() -> unavailable.registrationOptions(account)).isInstanceOf(MfaProofFailedException.class);
        assertThatThrownBy(() -> unavailable.authenticationOptions(account)).isInstanceOf(MfaProofFailedException.class);
    }

    @Test
    void givenACapitalisedDeploymentDomain_whenRegistering_thenTheRelyingPartyIdIsLowerCase() {
        // given
        var capitalised = new MfaWebAuthn(new InstanceAddress("https://Courts.Example.org:8443"),
                club, users, credentials, jdbc, clock);
        // when
        var options = capitalised.registrationOptions(account("doe.jane"));
        // then
        assertThat(options.getRp().getId()).isEqualTo(RP_ID);
    }

    private WebAuthnAuthenticatorFixture register(UUID account, String label) {
        var authenticator = new WebAuthnAuthenticatorFixture();
        var options = roundTrip(webAuthn.registrationOptions(account));
        assertThat(webAuthn.register(account, options, authenticator.register(options, ORIGIN), label)).isTrue();
        return authenticator;
    }

    private PublicKeyCredentialCreationOptions roundTrip(PublicKeyCredentialCreationOptions options) {
        return codec.decode(codec.encode(options), PublicKeyCredentialCreationOptions.class);
    }

    private PublicKeyCredentialRequestOptions roundTrip(PublicKeyCredentialRequestOptions options) {
        return codec.decode(codec.encode(options), PublicKeyCredentialRequestOptions.class);
    }

    private static PublicKeyCredentialCreationOptions creationOptions(PublicKeyCredentialCreationOptions options,
            boolean requiredUv, String rpId) {
        return PublicKeyCredentialCreationOptions.builder().challenge(options.getChallenge()).user(options.getUser())
                .rp(PublicKeyCredentialRpEntity.builder().id(rpId).name("Example Tennis Club").build())
                .pubKeyCredParams(options.getPubKeyCredParams()).attestation(options.getAttestation())
                .authenticatorSelection(AuthenticatorSelectionCriteria.builder().userVerification(requiredUv
                        ? UserVerificationRequirement.REQUIRED : UserVerificationRequirement.PREFERRED).build()).build();
    }

    private static PublicKeyCredentialRequestOptions requestOptions(PublicKeyCredentialRequestOptions options,
            boolean requiredUv, String rpId) {
        return PublicKeyCredentialRequestOptions.builder().challenge(options.getChallenge()).rpId(rpId)
                .allowCredentials(options.getAllowCredentials()).userVerification(requiredUv
                        ? UserVerificationRequirement.REQUIRED : UserVerificationRequirement.PREFERRED).build();
    }

    private static PublicKeyCredential<AuthenticatorAssertionResponse> response(
            PublicKeyCredential<AuthenticatorAssertionResponse> original, Bytes data, Bytes userHandle) {
        var response = AuthenticatorAssertionResponse.builder().authenticatorData(data).userHandle(userHandle)
                .clientDataJSON(original.getResponse().getClientDataJSON()).signature(original.getResponse().getSignature()).build();
        var builder = PublicKeyCredential.<AuthenticatorAssertionResponse>builder();
        builder.id(original.getId());
        builder.rawId(original.getRawId());
        builder.type(original.getType());
        builder.response(response);
        return builder.build();
    }

    private UUID account(String username) {
        UUID id = UUID.randomUUID();
        jdbc.sql("INSERT INTO person (id, first_name, last_name, email) VALUES (:id, 'Jane', 'Doe', :email)")
                .param("id", id).param("email", id + "@example.org").update();
        jdbc.sql("""
                INSERT INTO user_account (id, person_id, username, locale, enabled, password_change_required, password_hash)
                VALUES (:id, :id, :username, 'en', true, false, 'test-password-hash')
                """).param("id", id).param("username", username).update();
        return id;
    }
}
