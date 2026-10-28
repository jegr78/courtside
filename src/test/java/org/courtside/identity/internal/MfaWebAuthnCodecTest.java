package org.courtside.identity.internal;

import org.courtside.api.ApiWebAuthnCreationOptions;
import org.courtside.api.ApiWebAuthnRequestOptions;
import org.courtside.api.ApiWebAuthnRegistrationCredential;
import org.courtside.api.ApiWebAuthnAssertionCredential;
import org.junit.jupiter.api.Test;
import org.springframework.security.web.webauthn.api.AuthenticatorSelectionCriteria;
import org.springframework.security.web.webauthn.api.Bytes;
import org.springframework.security.web.webauthn.api.ImmutablePublicKeyCredentialUserEntity;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialCreationOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialParameters;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRequestOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRpEntity;
import org.springframework.security.web.webauthn.api.ResidentKeyRequirement;
import org.springframework.security.web.webauthn.api.UserVerificationRequirement;

import java.util.Map;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MfaWebAuthnCodecTest {
    private final MfaWebAuthnCodec codec = new MfaWebAuthnCodec();

    @Test
    void givenNativeOptions_whenEncodingJson_thenTheBrowserReceivesStandardValuesAndUvRemainsRequired() {
        // given
        var options = creation();
        // when
        String json = codec.encode(options);
        var restored = codec.decode(json, PublicKeyCredentialCreationOptions.class);
        // then
        assertThat(json).contains("\"userVerification\":\"required\"", "\"residentKey\":\"preferred\"", "\"alg\":-7")
                .doesNotContain("@class", "java.lang");
        var api = codec.toApi(options, ApiWebAuthnCreationOptions.class);
        assertThat(api.getChallenge()).isEqualTo(options.getChallenge().toBase64UrlString());
        assertThat(api.getAuthenticatorSelection().getUserVerification().getValue()).isEqualTo("required");
        assertThat(restored.getChallenge()).isEqualTo(options.getChallenge());
        assertThat(restored.getUser().getId()).isEqualTo(options.getUser().getId());
        assertThat(restored.getAuthenticatorSelection().getUserVerification()).isEqualTo(UserVerificationRequirement.REQUIRED);
    }

    @Test
    void givenCredentialResponses_whenConvertingThroughTransportObjects_thenTheAuthenticatorBytesStayUnchanged() {
        // given
        var authenticator = new WebAuthnAuthenticatorFixture();
        var registration = authenticator.register(creation(), "https://courts.example.org");
        var request = PublicKeyCredentialRequestOptions.builder().rpId("courts.example.org")
                .challenge(Bytes.random()).userVerification(UserVerificationRequirement.REQUIRED).build();
        var assertion = authenticator.assertion(request, "https://courts.example.org");
        // when
        var restoredRegistration = codec.attestation(codec.toApi(registration, ApiWebAuthnRegistrationCredential.class));
        var restoredAssertion = codec.assertion(codec.toApi(assertion, ApiWebAuthnAssertionCredential.class));
        // then
        assertThat(restoredRegistration.getRawId()).isEqualTo(registration.getRawId());
        assertThat(restoredRegistration.getResponse().getAttestationObject()).isEqualTo(registration.getResponse().getAttestationObject());
        assertThat(restoredAssertion.getResponse().getAuthenticatorData()).isEqualTo(assertion.getResponse().getAuthenticatorData());
        assertThat(restoredAssertion.getResponse().getSignature()).isEqualTo(assertion.getResponse().getSignature());
        assertThat(restoredAssertion.getResponse().getUserHandle()).isEqualTo(assertion.getResponse().getUserHandle());
        assertThat(codec.toApi(request, ApiWebAuthnRequestOptions.class).getUserVerification().getValue()).isEqualTo("required");
        assertThat(codec.decode(codec.encode(request), PublicKeyCredentialRequestOptions.class).getUserVerification())
                .isEqualTo(UserVerificationRequirement.REQUIRED);
    }

    @Test
    void givenMalformedOrPolymorphicInput_whenDecoding_thenOnlyTheGenericProofFailureEscapes() {
        // given
        String malformed = "{\"challenge\":\"not valid base64?\"}";
        String polymorphic = "{\"@class\":\"java.lang.ProcessBuilder\",\"command\":[\"invalid\"]}";
        // when / then
        assertThatThrownBy(() -> codec.decode(malformed, PublicKeyCredentialRequestOptions.class))
                .isInstanceOf(MfaProofFailedException.class).hasMessage("identity.mfa.proofFailed");
        assertThatThrownBy(() -> codec.decode(polymorphic, PublicKeyCredentialRequestOptions.class))
                .isInstanceOf(MfaProofFailedException.class);
        assertThatThrownBy(() -> codec.attestation(Map.of("rawId", "malformed base64?")))
                .isInstanceOf(MfaProofFailedException.class);
    }

    @Test
    void givenNativeTimeoutAndExtensionOptions_whenRoundTripping_thenBrowserValuesArePreserved() {
        // given
        String json = "{\"challenge\":\"AQID\",\"rpId\":\"courts.example.org\",\"timeout\":45000,"
                + "\"userVerification\":\"preferred\",\"extensions\":{\"credProps\":true}}";
        // when
        var options = codec.decode(json, PublicKeyCredentialRequestOptions.class);
        var restored = codec.decode(codec.encode(options), PublicKeyCredentialRequestOptions.class);
        // then
        assertThat(restored.getTimeout()).isEqualTo(Duration.ofSeconds(45));
        assertThat(restored.getUserVerification()).isEqualTo(UserVerificationRequirement.PREFERRED);
        assertThat(codec.encode(restored)).contains("\"credProps\":true", "\"timeout\":45000");
        assertThat(codec.decode(json.replace("preferred", "discouraged"), PublicKeyCredentialRequestOptions.class)
                .getUserVerification()).isEqualTo(UserVerificationRequirement.DISCOURAGED);
    }

    @Test
    void givenAbsentOrUnknownProtocolValues_whenDecoding_thenOnlyTheTypedProofFailureEscapes() {
        // when / then
        assertThatThrownBy(() -> codec.decode("null", PublicKeyCredentialRequestOptions.class))
                .isInstanceOf(MfaProofFailedException.class).hasMessage("identity.mfa.proofFailed");
        assertThatThrownBy(() -> codec.attestation(null))
                .isInstanceOf(MfaProofFailedException.class).hasMessage("identity.mfa.proofFailed");
        assertThatThrownBy(() -> codec.assertion(Map.of("rawId", "not valid base64?")))
                .isInstanceOf(MfaProofFailedException.class).hasMessage("identity.mfa.proofFailed");
        assertThatThrownBy(() -> codec.decode("{\"userVerification\":\"optional\"}", PublicKeyCredentialRequestOptions.class))
                .isInstanceOf(MfaProofFailedException.class).hasMessage("identity.mfa.proofFailed");
    }

    private static PublicKeyCredentialCreationOptions creation() {
        return PublicKeyCredentialCreationOptions.builder().challenge(Bytes.random())
                .rp(PublicKeyCredentialRpEntity.builder().id("courts.example.org").name("Example Tennis Club").build())
                .user(ImmutablePublicKeyCredentialUserEntity.builder().id(Bytes.random()).name("jane.doe@example.org")
                        .displayName("Jane Doe").build()).pubKeyCredParams(PublicKeyCredentialParameters.ES256)
                .authenticatorSelection(AuthenticatorSelectionCriteria.builder().residentKey(ResidentKeyRequirement.PREFERRED)
                        .userVerification(UserVerificationRequirement.REQUIRED).build()).build();
    }
}
