package org.courtside;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

// The JDK exposes no way to write an X.509 certificate, and adding a library to sign one would be a
// dependency this repository carries for one test class.
public record TestCertificate(String certificate, String key, String authority) {

    private static final String SUBJECT = "/CN=courtside-service-under-test";
    private static final DateTimeFormatter MOMENT =
            DateTimeFormatter.ofPattern("uuuuMMddHHmmss'Z'").withZone(ZoneOffset.UTC);

    public static TestCertificate issuedFor(String name) throws Exception {
        Instant now = Instant.now();
        return issued(name, now.minus(Duration.ofHours(1)), now.plus(Duration.ofDays(1)));
    }

    public static TestCertificate expiredFor(String name) throws Exception {
        Instant ranOut = Instant.now().minus(Duration.ofDays(30));
        return issued(name, ranOut.minus(Duration.ofDays(30)), ranOut);
    }

    // Signed by an authority of its own rather than by itself, because a self-signed certificate
    // handed to a caller as its own anchor is one PKIX never checks the validity of.
    private static TestCertificate issued(String name, Instant from, Instant until)
            throws Exception {
        Path directory = Files.createTempDirectory("courtside-certificate-");
        try {
            Files.writeString(directory.resolve("index.txt"), "");
            Files.writeString(directory.resolve("serial"), "01\n");
            Files.writeString(directory.resolve("authority.cnf"), authorityConfiguration(name));
            openssl(directory, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=courtside-authority-under-test",
                    "-keyout", "authority.key", "-out", "authority.pem");
            openssl(directory, "req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", SUBJECT,
                    "-keyout", "key.pem", "-out", "request.pem");
            // `openssl req -x509` learned to backdate only in OpenSSL 3.5, and the runners this
            // build uses ship 3.0, where `openssl ca` is the one command that issues into the past.
            openssl(directory, "ca", "-batch", "-config", "authority.cnf",
                    "-cert", "authority.pem", "-keyfile", "authority.key",
                    "-in", "request.pem", "-out", "cert.pem", "-notext", "-extensions", "leaf",
                    "-startdate", MOMENT.format(from), "-enddate", MOMENT.format(until));
            return new TestCertificate(read(directory, "cert.pem"), read(directory, "key.pem"),
                    read(directory, "authority.pem"));
        } finally {
            discard(directory);
        }
    }

    private static String authorityConfiguration(String name) {
        return """
                [ca]
                default_ca = relay

                [relay]
                database = index.txt
                serial = serial
                new_certs_dir = .
                default_md = sha256
                policy = anything
                email_in_dn = no
                rand_serial = no
                unique_subject = no

                [anything]
                commonName = optional

                [leaf]
                basicConstraints = critical,CA:FALSE
                subjectAltName = DNS:%s
                """.formatted(name);
    }

    private static String read(Path directory, String name) throws IOException {
        return Files.readString(directory.resolve(name));
    }

    private static void openssl(Path directory, String... arguments) throws Exception {
        List<String> command = new ArrayList<>(List.of(executable("openssl").toString()));
        command.addAll(List.of(arguments));
        Process openssl = new ProcessBuilder(command)
                .directory(directory.toFile()).redirectErrorStream(true).start();
        String output = new String(openssl.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (openssl.waitFor() != 0) {
            throw new IllegalStateException("Could not issue the test certificate: " + output);
        }
    }

    private static void discard(Path directory) throws IOException {
        try (Stream<Path> written = Files.walk(directory)) {
            for (Path path : written.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    public static Path executable(String name) {
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

    public static Path executable(String name, List<Path> directories, List<String> extensions) {
        return directories.stream()
                .filter(Path::isAbsolute)
                .flatMap(directory -> extensions.stream().map(extension -> directory.resolve(name + extension)))
                .filter(candidate -> Files.isRegularFile(candidate) && Files.isExecutable(candidate))
                .findFirst()
                .map(candidate -> candidate.toAbsolutePath().normalize())
                .orElseThrow(() -> new IllegalStateException("PATH does not name an OpenSSL executable"));
    }

    public static List<String> executableExtensions() {
        String pathExtensions = System.getenv("PATHEXT");
        if (pathExtensions == null || pathExtensions.isBlank()) {
            return List.of("");
        }
        return Arrays.stream(pathExtensions.split(Pattern.quote(File.pathSeparator)))
                .map(String::toLowerCase)
                .toList();
    }
}
