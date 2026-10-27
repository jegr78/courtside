package org.courtside.identity.internal;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.security.web.webauthn.api.AttestationConveyancePreference;
import org.springframework.security.web.webauthn.api.AuthenticationExtensionsClientInput;
import org.springframework.security.web.webauthn.api.AuthenticationExtensionsClientInputs;
import org.springframework.security.web.webauthn.api.AuthenticatorAttachment;
import org.springframework.security.web.webauthn.api.AuthenticatorSelectionCriteria;
import org.springframework.security.web.webauthn.api.AuthenticatorTransport;
import org.springframework.security.web.webauthn.api.Bytes;
import org.springframework.security.web.webauthn.api.COSEAlgorithmIdentifier;
import org.springframework.security.web.webauthn.api.ImmutableAuthenticationExtensionsClientInput;
import org.springframework.security.web.webauthn.api.ImmutableAuthenticationExtensionsClientInputs;
import org.springframework.security.web.webauthn.api.ImmutablePublicKeyCredentialUserEntity;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialCreationOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialDescriptor;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialParameters;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRequestOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRpEntity;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialType;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialUserEntity;
import org.springframework.security.web.webauthn.api.ResidentKeyRequirement;
import org.springframework.security.web.webauthn.api.UserVerificationRequirement;
import org.springframework.security.web.webauthn.api.AuthenticatorAssertionResponse;
import org.springframework.security.web.webauthn.api.AuthenticatorAttestationResponse;
import org.springframework.security.web.webauthn.api.PublicKeyCredential;
import org.springframework.security.web.webauthn.jackson.WebauthnJacksonModule;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.annotation.JsonDeserialize;
import tools.jackson.databind.deser.std.StdDeserializer;
import tools.jackson.databind.ser.std.StdSerializer;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
class MfaWebAuthnCodec {
    private static final TypeReference<PublicKeyCredential<AuthenticatorAttestationResponse>> ATTESTATION = new TypeReference<>() { };
    private static final TypeReference<PublicKeyCredential<AuthenticatorAssertionResponse>> ASSERTION = new TypeReference<>() { };
    private final JsonMapper mapper = JsonMapper.builder().addModule(new WebauthnJacksonModule())
            .addModule(optionsModule()).enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .changeDefaultPropertyInclusion(value -> value.withValueInclusion(JsonInclude.Include.NON_NULL)).build();

    private static SimpleModule optionsModule() {
        return new SimpleModule().addDeserializer(UserVerificationRequirement.class, new VerificationDeserializer())
                .addDeserializer(Duration.class, new TimeoutDeserializer())
                .addSerializer(Duration.class, new TimeoutSerializer())
                .addDeserializer(AuthenticationExtensionsClientInputs.class, new ExtensionInputsDeserializer())
                .setMixInAnnotation(PublicKeyCredentialCreationOptions.class, CreationOptionsMixin.class)
                .setMixInAnnotation(PublicKeyCredentialRequestOptions.class, RequestOptionsMixin.class)
                .setMixInAnnotation(PublicKeyCredentialRpEntity.class, RpMixin.class)
                .setMixInAnnotation(PublicKeyCredentialUserEntity.class, UserMixin.class)
                .setMixInAnnotation(PublicKeyCredentialParameters.class, ParametersMixin.class)
                .setMixInAnnotation(PublicKeyCredentialDescriptor.class, DescriptorMixin.class)
                .setMixInAnnotation(AuthenticatorSelectionCriteria.class, SelectionMixin.class);
    }

    String encode(Object value) {
        return mapper.writeValueAsString(value);
    }

    <T> T decode(String json, Class<T> type) {
        try {
            T result = mapper.readValue(json, type);
            if (result == null) throw new MfaProofFailedException();
            return result;
        } catch (JacksonException | IllegalArgumentException malformed) {
            throw new MfaProofFailedException();
        }
    }

    PublicKeyCredential<AuthenticatorAttestationResponse> attestation(Object value) {
        return credential(value, ATTESTATION);
    }

    PublicKeyCredential<AuthenticatorAssertionResponse> assertion(Object value) {
        return credential(value, ASSERTION);
    }

    <T> T toApi(Object value, Class<T> type) {
        return mapper.convertValue(value, type);
    }

    private <T> T credential(Object value, TypeReference<T> type) {
        try {
            T result = mapper.convertValue(value, type);
            if (result == null) throw new MfaProofFailedException();
            return result;
        } catch (JacksonException | IllegalArgumentException malformed) {
            throw new MfaProofFailedException();
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    private abstract static class CreationOptionsMixin {
        @JsonCreator
        CreationOptionsMixin(@JsonProperty("rp") PublicKeyCredentialRpEntity rp,
                @JsonProperty("user") PublicKeyCredentialUserEntity user, @JsonProperty("challenge") Bytes challenge,
                @JsonProperty("pubKeyCredParams") List<PublicKeyCredentialParameters> parameters,
                @JsonProperty("timeout") Duration timeout, @JsonProperty("excludeCredentials") List<PublicKeyCredentialDescriptor> excluded,
                @JsonProperty("authenticatorSelection") AuthenticatorSelectionCriteria selection,
                @JsonProperty("attestation") AttestationConveyancePreference attestation,
                @JsonProperty("extensions") AuthenticationExtensionsClientInputs extensions) { }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    private abstract static class RequestOptionsMixin {
        @JsonCreator
        RequestOptionsMixin(@JsonProperty("challenge") Bytes challenge, @JsonProperty("timeout") Duration timeout,
                @JsonProperty("rpId") String rpId, @JsonProperty("allowCredentials") List<PublicKeyCredentialDescriptor> allowed,
                @JsonProperty("userVerification") UserVerificationRequirement verification,
                @JsonProperty("extensions") AuthenticationExtensionsClientInputs extensions) { }
    }

    private abstract static class RpMixin {
        @JsonCreator
        RpMixin(@JsonProperty("name") String name, @JsonProperty("id") String id) { }
    }

    @JsonDeserialize(as = ImmutablePublicKeyCredentialUserEntity.class)
    private abstract static class UserMixin { }

    private abstract static class ParametersMixin {
        @JsonCreator
        ParametersMixin(@JsonProperty("type") PublicKeyCredentialType type, @JsonProperty("alg") COSEAlgorithmIdentifier algorithm) { }
    }

    private abstract static class DescriptorMixin {
        @JsonCreator
        DescriptorMixin(@JsonProperty("type") PublicKeyCredentialType type, @JsonProperty("id") Bytes id,
                @JsonProperty("transports") Set<AuthenticatorTransport> transports) { }
    }

    private abstract static class SelectionMixin {
        @JsonCreator
        SelectionMixin(@JsonProperty("authenticatorAttachment") AuthenticatorAttachment attachment,
                @JsonProperty("residentKey") ResidentKeyRequirement residentKey,
                @JsonProperty("userVerification") UserVerificationRequirement verification) { }
    }

    private static final class VerificationDeserializer extends StdDeserializer<UserVerificationRequirement> {
        VerificationDeserializer() { super(UserVerificationRequirement.class); }

        @Override
        public UserVerificationRequirement deserialize(JsonParser parser, DeserializationContext context) {
            return switch (parser.getString()) {
                case "required" -> UserVerificationRequirement.REQUIRED;
                case "preferred" -> UserVerificationRequirement.PREFERRED;
                case "discouraged" -> UserVerificationRequirement.DISCOURAGED;
                default -> throw new MfaProofFailedException();
            };
        }
    }

    private static final class TimeoutDeserializer extends StdDeserializer<Duration> {
        TimeoutDeserializer() { super(Duration.class); }

        @Override
        public Duration deserialize(JsonParser parser, DeserializationContext context) {
            return Duration.ofMillis(parser.getLongValue());
        }
    }

    private static final class TimeoutSerializer extends StdSerializer<Duration> {
        TimeoutSerializer() { super(Duration.class); }

        @Override
        public void serialize(Duration value, JsonGenerator generator, SerializationContext context) {
            generator.writeNumber(value.toMillis());
        }
    }

    private static final class ExtensionInputsDeserializer extends StdDeserializer<AuthenticationExtensionsClientInputs> {
        ExtensionInputsDeserializer() { super(AuthenticationExtensionsClientInputs.class); }

        @Override
        public AuthenticationExtensionsClientInputs deserialize(JsonParser parser, DeserializationContext context) {
            Map<String, Object> inputs = parser.readValueAs(new TypeReference<>() { });
            var extensions = inputs.entrySet().stream().map(entry ->
                    new ImmutableAuthenticationExtensionsClientInput<>(entry.getKey(), entry.getValue()))
                    .toArray(AuthenticationExtensionsClientInput[]::new);
            return new ImmutableAuthenticationExtensionsClientInputs(extensions);
        }
    }

}
