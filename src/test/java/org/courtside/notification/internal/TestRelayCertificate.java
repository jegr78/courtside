package org.courtside.notification.internal;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

// The JDK exposes no way to write an X.509 certificate, and adding a library to sign one would be a
// dependency this repository carries for two tests.
record TestRelayCertificate(String certificate, String key) {

    static TestRelayCertificate issuedFor(String name) throws Exception {
        Path directory = Files.createTempDirectory("courtside-relay-");
        Path certificate = directory.resolve("cert.pem");
        Path key = directory.resolve("key.pem");
        Process openssl = new ProcessBuilder("openssl", "req", "-x509", "-newkey", "rsa:2048",
                "-nodes", "-days", "1", "-subj", "/CN=courtside-relay-under-test",
                "-addext", "subjectAltName=DNS:" + name,
                "-keyout", key.toString(), "-out", certificate.toString())
                .redirectErrorStream(true).start();
        String output = new String(openssl.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (openssl.waitFor() != 0) {
            throw new IllegalStateException("Could not issue the relay certificate: " + output);
        }
        return new TestRelayCertificate(Files.readString(certificate), Files.readString(key));
    }
}
