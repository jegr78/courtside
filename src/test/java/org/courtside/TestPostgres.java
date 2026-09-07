package org.courtside;

import org.testcontainers.images.builder.Transferable;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class TestPostgres {

    private static final Path OVERLAY = Path.of("deploy", "compose.database-tls-local.yaml");
    private static final Pattern SERVER_COMMAND =
            Pattern.compile("command: \\[\"sh\", \"-c\", \"(?<script>[^\"]+)\"]");
    private static final Pattern MOUNTED = Pattern.compile(":(?<path>/etc/courtside/server\\.\\w+):ro");

    private TestPostgres() {
    }

    // The reference deployment's own command, run against the reference deployment's own image, so
    // that what an operator enables is what a verification run exercises.
    public static PostgreSQLContainer serving(TestCertificate pair) {
        String overlay = read();
        PostgreSQLContainer postgres = new PostgreSQLContainer(
                TestcontainersConfiguration.deployedPostgresImage());
        postgres.withCopyToContainer(Transferable.of(pair.certificate()), mounted(overlay, "crt"))
                .withCopyToContainer(Transferable.of(pair.key()), mounted(overlay, "key"))
                .withCommand("sh", "-c", serverCommand(overlay));
        return postgres;
    }

    public static PostgreSQLContainer sharedPlaintext() {
        return TestcontainersConfiguration.sharedPostgres();
    }

    private static String serverCommand(String overlay) {
        Matcher found = SERVER_COMMAND.matcher(overlay);
        if (!found.find()) {
            throw new IllegalStateException(OVERLAY + " names no shell command for the database");
        }
        return found.group("script");
    }

    private static String mounted(String overlay, String extension) {
        Matcher mounts = MOUNTED.matcher(overlay);
        while (mounts.find()) {
            if (mounts.group("path").endsWith("." + extension)) {
                return mounts.group("path");
            }
        }
        throw new IllegalStateException(OVERLAY + " mounts no ." + extension + " for the database");
    }

    private static String read() {
        try {
            return Files.readString(OVERLAY);
        } catch (IOException failure) {
            throw new IllegalStateException("Could not read " + OVERLAY, failure);
        }
    }
}
