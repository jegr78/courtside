package org.courtside.notification.internal;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;

// The JDK exposes no way to write an X.509 certificate, and adding a library to sign one would be a
// dependency this repository carries for two tests.
record TestRelayCertificate(String certificate, String key) {

    static TestRelayCertificate issuedFor(String name) throws Exception {
        Path directory = Files.createTempDirectory("courtside-relay-");
        Path certificate = directory.resolve("cert.pem");
        Path key = directory.resolve("key.pem");
        try {
            Process openssl = new ProcessBuilder(executable("openssl").toString(), "req", "-x509",
                    "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=courtside-relay-under-test", "-addext", "subjectAltName=DNS:" + name,
                    "-keyout", key.toString(), "-out", certificate.toString())
                    .redirectErrorStream(true).start();
            String output = new String(openssl.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (openssl.waitFor() != 0) {
                throw new IllegalStateException("Could not issue the relay certificate: " + output);
            }
            return new TestRelayCertificate(Files.readString(certificate), Files.readString(key));
        } finally {
            Files.deleteIfExists(certificate);
            Files.deleteIfExists(key);
            Files.deleteIfExists(directory);
        }
    }

    static Path executable(String name) {
        String searchPath = System.getenv("PATH");
        if (searchPath == null || searchPath.isBlank()) {
            throw new IllegalStateException("PATH does not name an OpenSSL executable");
        }
        List<Path> directories = Arrays.stream(searchPath.split(Pattern.quote(File.pathSeparator)))
                .filter(entry -> !entry.isBlank())
                .map(Path::of)
                .toList();
        return executable(name, directories, executableExtensions());
    }

    static Path executable(String name, List<Path> directories, List<String> extensions) {
        return directories.stream()
                .filter(Path::isAbsolute)
                .flatMap(directory -> extensions.stream().map(extension -> directory.resolve(name + extension)))
                .filter(candidate -> Files.isRegularFile(candidate) && Files.isExecutable(candidate))
                .findFirst()
                .map(candidate -> candidate.toAbsolutePath().normalize())
                .orElseThrow(() -> new IllegalStateException("PATH does not name an OpenSSL executable"));
    }

    static List<String> executableExtensions() {
        String pathExtensions = System.getenv("PATHEXT");
        if (pathExtensions == null || pathExtensions.isBlank()) {
            return List.of("");
        }
        return Arrays.stream(pathExtensions.split(Pattern.quote(File.pathSeparator)))
                .map(String::toLowerCase)
                .toList();
    }
}
