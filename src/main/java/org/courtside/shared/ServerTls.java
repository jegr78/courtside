package org.courtside.shared;

import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.web.server.ConfigurableWebServerFactory;
import org.springframework.boot.web.server.Ssl;
import org.springframework.core.env.Environment;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;

final class ServerTls {

    private static final String CERTIFICATE = "courtside.server.tls.certificate";
    private static final String PRIVATE_KEY = "courtside.server.tls.private-key";
    private static final String SPRING_PREFIX = "server.ssl";
    private static final String KEY_HEADER = "-----BEGIN";
    private static final String KEY_LABEL = "PRIVATE KEY-----";
    private static final String ENCRYPTED_KEY_LABEL = "ENCRYPTED PRIVATE KEY-----";
    private static final String MATERIAL_ACTION = "Point " + CERTIFICATE + " and " + PRIVATE_KEY
            + " at the certificate this instance serves and the key belonging to it, or set"
            + " courtside.server.tls.mode back to plaintext.";
    private static final String OVERRIDE_ACTION = "Remove it, and leave what this instance serves"
            + " to courtside.server.tls.mode.";
    private static final String ENCRYPTED_ACTION = "Store the key this instance serves without a"
            + " password, readable only by the account the container runs as.";

    private ServerTls() {
    }

    static void apply(ConfigurableWebServerFactory factory, ServerTlsProperties tls) {
        if (tls.mode() != ServerTlsProperties.Mode.SERVE) {
            return;
        }
        Ssl ssl = new Ssl();
        ssl.setEnabled(true);
        ssl.setCertificate(certificate(tls).toString());
        ssl.setCertificatePrivateKey(privateKey(tls).toString());
        factory.setSsl(ssl);
    }

    static void check(ServerTlsProperties tls, Environment environment) {
        if (tls.mode() != ServerTlsProperties.Mode.SERVE) {
            return;
        }
        refuseWhatWouldDecideWhatIsServed(environment);
        certificate(tls);
        privateKey(tls);
    }

    // Spring's own server.ssl properties reach the same factory, and an operator sets them as
    // SERVER_SSL_..., which only relaxed binding turns into the name a scan would look for.
    private static void refuseWhatWouldDecideWhatIsServed(Environment environment) {
        if (Binder.get(environment).bind(SPRING_PREFIX, Bindable.of(Ssl.class)).isBound()) {
            throw new TlsConfigurationException("The application is configured to serve TLS, and"
                    + " Spring's own " + SPRING_PREFIX + " configuration would decide what it"
                    + " serves instead.", OVERRIDE_ACTION);
        }
    }

    private static Path certificate(ServerTlsProperties tls) {
        Path material = readable(tls.certificate(), CERTIFICATE);
        try (InputStream stream = Files.newInputStream(material)) {
            if (CertificateFactory.getInstance("X.509").generateCertificates(stream).isEmpty()) {
                throw new TlsConfigurationException(CERTIFICATE + " names " + material
                        + ", which holds no certificate.", MATERIAL_ACTION);
            }
        } catch (IOException | CertificateException failure) {
            throw new TlsConfigurationException(CERTIFICATE + " names " + material
                    + ", which is not readable X.509 material.", MATERIAL_ACTION, failure);
        }
        return material;
    }

    private static Path privateKey(ServerTlsProperties tls) {
        Path material = readable(tls.privateKey(), PRIVATE_KEY);
        String pem = read(material);
        if (!pem.contains(KEY_HEADER) || !pem.contains(KEY_LABEL)) {
            throw new TlsConfigurationException(PRIVATE_KEY + " names " + material
                    + ", which holds no private key.", MATERIAL_ACTION);
        }
        if (pem.contains(ENCRYPTED_KEY_LABEL)) {
            throw new TlsConfigurationException(PRIVATE_KEY + " names " + material
                    + ", which holds a password-protected private key, and this instance is given"
                    + " no password to open it with.", ENCRYPTED_ACTION);
        }
        return material;
    }

    private static Path readable(Path material, String property) {
        if (material == null || material.toString().isBlank()) {
            throw new TlsConfigurationException("The application is configured to serve TLS, but "
                    + property + " names no file.", MATERIAL_ACTION);
        }
        if (!Files.isReadable(material)) {
            throw new TlsConfigurationException(property + " names " + material
                    + ", which does not exist or cannot be read.", MATERIAL_ACTION);
        }
        return material;
    }

    private static String read(Path material) {
        try {
            return Files.readString(material, StandardCharsets.UTF_8);
        } catch (IOException failure) {
            throw new TlsConfigurationException(PRIVATE_KEY + " names " + material
                    + ", which is not readable PEM material.", MATERIAL_ACTION, failure);
        }
    }
}
