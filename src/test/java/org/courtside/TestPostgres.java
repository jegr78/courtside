package org.courtside;

import org.testcontainers.images.builder.Transferable;
import org.testcontainers.postgresql.PostgreSQLContainer;

public final class TestPostgres {

    private static final String CERTIFICATE = "/tls/server.crt";
    private static final String KEY = "/tls/server.key";

    private TestPostgres() {
    }

    // The image copies both files in as root, and PostgreSQL refuses to start on a key any user
    // but its own can read, so the key changes hands before the real entrypoint takes over.
    public static PostgreSQLContainer serving(TestCertificate pair) {
        PostgreSQLContainer postgres = new PostgreSQLContainer(
                TestcontainersConfiguration.deployedPostgresImage());
        postgres.withCopyToContainer(Transferable.of(pair.certificate()), CERTIFICATE)
                .withCopyToContainer(Transferable.of(pair.key()), KEY)
                .withCommand("sh", "-c", "chown postgres " + KEY + " && chmod 600 " + KEY
                        + " && exec docker-entrypoint.sh postgres -c ssl=on"
                        + " -c ssl_cert_file=" + CERTIFICATE + " -c ssl_key_file=" + KEY);
        return postgres;
    }

    public static PostgreSQLContainer sharedPlaintext() {
        return TestcontainersConfiguration.sharedPostgres();
    }
}
