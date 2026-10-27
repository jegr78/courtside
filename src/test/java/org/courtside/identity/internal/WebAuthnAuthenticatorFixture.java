package org.courtside.identity.internal;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Map;

import com.webauthn4j.converter.AuthenticatorDataConverter;
import com.webauthn4j.converter.util.ObjectConverter;
import com.webauthn4j.data.attestation.AttestationObject;
import com.webauthn4j.data.attestation.authenticator.AAGUID;
import com.webauthn4j.data.attestation.authenticator.AttestedCredentialData;
import com.webauthn4j.data.attestation.authenticator.AuthenticatorData;
import com.webauthn4j.data.attestation.authenticator.EC2COSEKey;
import com.webauthn4j.data.attestation.statement.COSEAlgorithmIdentifier;
import com.webauthn4j.data.attestation.statement.NoneAttestationStatement;
import com.webauthn4j.data.extension.authenticator.AuthenticationExtensionAuthenticatorOutput;
import com.webauthn4j.data.extension.authenticator.RegistrationExtensionAuthenticatorOutput;
import org.springframework.security.web.webauthn.api.AuthenticatorAssertionResponse;
import org.springframework.security.web.webauthn.api.AuthenticatorAttestationResponse;
import org.springframework.security.web.webauthn.api.AuthenticatorResponse;
import org.springframework.security.web.webauthn.api.AuthenticatorTransport;
import org.springframework.security.web.webauthn.api.Bytes;
import org.springframework.security.web.webauthn.api.PublicKeyCredential;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialCreationOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRequestOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialType;

public final class WebAuthnAuthenticatorFixture {
    private final ObjectConverter converter = new ObjectConverter();
    private final KeyPair keyPair;
    private final Bytes credentialId = Bytes.random();
    private Bytes userHandle;
    private long signatureCount;

    public WebAuthnAuthenticatorFixture() {
        try {
            var generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(new ECGenParameterSpec("secp256r1"));
            keyPair = generator.generateKeyPair();
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("Cannot create test authenticator key", failure);
        }
    }

    public Bytes credentialId() {
        return new Bytes(credentialId.getBytes().clone());
    }

    public PublicKeyCredential<AuthenticatorAttestationResponse> register(
            PublicKeyCredentialCreationOptions options, String origin) {
        return register(options, origin, true, options.getRp().getId(), 0);
    }

    public PublicKeyCredential<AuthenticatorAttestationResponse> register(
            PublicKeyCredentialCreationOptions options, String origin, boolean userVerified,
            String rpId, long counter) {
        validateCounter(counter);
        userHandle = new Bytes(options.getUser().getId().getBytes().clone());
        signatureCount = counter;
        var coseKey = EC2COSEKey.create((ECPublicKey) keyPair.getPublic(), COSEAlgorithmIdentifier.ES256);
        var credentialData = new AttestedCredentialData(AAGUID.ZERO, credentialId.getBytes(), coseKey);
        var authenticatorData = new AuthenticatorData<RegistrationExtensionAuthenticatorOutput>(
                hash(rpId.getBytes(StandardCharsets.UTF_8)), flags(userVerified, true), counter, credentialData);
        var attestationObject = new AttestationObject(authenticatorData, new NoneAttestationStatement());
        var response = AuthenticatorAttestationResponse.builder()
                .attestationObject(new Bytes(converter.getCborMapper().writeValueAsBytes(attestationObject)))
                .clientDataJSON(new Bytes(clientData("webauthn.create", options.getChallenge(), origin)))
                .transports(AuthenticatorTransport.USB)
                .build();
        return credential(response);
    }

    public PublicKeyCredential<AuthenticatorAssertionResponse> assertion(
            PublicKeyCredentialRequestOptions options, String origin) {
        return assertion(options, origin, true, options.getRpId(), signatureCount + 1, false);
    }

    public PublicKeyCredential<AuthenticatorAssertionResponse> assertion(
            PublicKeyCredentialRequestOptions options, String origin, boolean userVerified,
            String rpId, long counter, boolean invalidSignature) {
        validateCounter(counter);
        if (userHandle == null) throw new IllegalStateException("Register the test authenticator first");
        signatureCount = counter;
        var data = new AuthenticatorData<AuthenticationExtensionAuthenticatorOutput>(
                hash(rpId.getBytes(StandardCharsets.UTF_8)), flags(userVerified, false), counter);
        byte[] authenticatorData = new AuthenticatorDataConverter(converter).convert(data);
        byte[] clientData = clientData("webauthn.get", options.getChallenge(), origin);
        byte[] signature = sign(authenticatorData, hash(clientData));
        if (invalidSignature) signature[signature.length - 1] ^= 1;
        var response = AuthenticatorAssertionResponse.builder()
                .authenticatorData(new Bytes(authenticatorData))
                .clientDataJSON(new Bytes(clientData))
                .signature(new Bytes(signature))
                .userHandle(new Bytes(userHandle.getBytes().clone()))
                .build();
        return credential(response);
    }

    private <R extends AuthenticatorResponse> PublicKeyCredential<R> credential(R response) {
        var builder = PublicKeyCredential.<R>builder();
        builder.id(credentialId.toBase64UrlString());
        builder.rawId(credentialId());
        builder.type(PublicKeyCredentialType.PUBLIC_KEY);
        builder.response(response);
        return builder.build();
    }

    private byte[] clientData(String type, Bytes challenge, String origin) {
        return converter.getJsonMapper().writeValueAsBytes(Map.of(
                "type", type, "challenge", challenge.toBase64UrlString(), "origin", origin, "crossOrigin", false));
    }

    private byte[] sign(byte[] authenticatorData, byte[] clientDataHash) {
        try {
            var signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign(keyPair.getPrivate());
            signer.update(authenticatorData);
            signer.update(clientDataHash);
            return signer.sign();
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("Cannot sign test authenticator assertion", failure);
        }
    }

    private static byte[] hash(byte[] value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("Cannot hash test authenticator data", failure);
        }
    }

    private static byte flags(boolean userVerified, boolean attested) {
        return (byte) (AuthenticatorData.BIT_UP | (userVerified ? AuthenticatorData.BIT_UV : 0)
                | (attested ? AuthenticatorData.BIT_AT : 0));
    }

    private static void validateCounter(long counter) {
        if (counter < 0 || counter > 0xffffffffL) {
            throw new IllegalArgumentException("Authenticator counter must fit an unsigned 32-bit integer");
        }
    }
}
