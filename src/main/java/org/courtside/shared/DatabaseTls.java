package org.courtside.shared;

import com.zaxxer.hikari.HikariDataSource;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.util.Locale;

final class DatabaseTls {

    private static final String VERIFY_FULL = "verify-full";
    private static final String DISABLED = "disable";
    private static final String TRANSPORT_PARAMETER = "ssl";
    private static final String ROOT_CERTIFICATE = "courtside.database.tls.root-certificate";

    private DatabaseTls() {
    }

    // PREFER leaves the driver's own default in place, which encrypts opportunistically and
    // verifies nothing, so naming it after the driver is the only description that stays true.
    static void apply(HikariDataSource dataSource, DatabaseTlsProperties tls) {
        switch (tls.mode()) {
            case PREFER -> {
            }
            case DISABLE -> dataSource.addDataSourceProperty("sslmode", DISABLED);
            case VERIFY_FULL -> verify(dataSource, tls.rootCertificate());
        }
    }

    private static void verify(HikariDataSource dataSource, Path rootCertificate) {
        Path anchor = readable(rootCertificate);
        refuseUrlThatDecidesTheTransport(dataSource.getJdbcUrl());
        dataSource.addDataSourceProperty("sslmode", VERIFY_FULL);
        dataSource.addDataSourceProperty("sslrootcert", anchor.toString());
    }

    // The driver lets a URL argument override the pool's own property, so a URL that names the
    // transport would silently connect in plaintext with verification configured.
    private static void refuseUrlThatDecidesTheTransport(String jdbcUrl) {
        if (jdbcUrl == null || jdbcUrl.indexOf('?') < 0) {
            return;
        }
        for (String argument : jdbcUrl.substring(jdbcUrl.indexOf('?') + 1).split("&")) {
            String name = argument.split("=", 2)[0].toLowerCase(Locale.ROOT);
            if (name.startsWith(TRANSPORT_PARAMETER)) {
                throw new DatabaseTlsMaterialException("The database connection URL carries the "
                        + "argument '" + name + "', which overrides the verification "
                        + ROOT_CERTIFICATE + " configures. Remove it from the URL.");
            }
        }
    }

    private static Path readable(Path rootCertificate) {
        if (rootCertificate == null || rootCertificate.toString().isBlank()) {
            throw new DatabaseTlsMaterialException("Verified database TLS is configured, but "
                    + ROOT_CERTIFICATE + " names no file.");
        }
        if (!Files.isReadable(rootCertificate)) {
            throw new DatabaseTlsMaterialException(ROOT_CERTIFICATE + " names " + rootCertificate
                    + ", which does not exist or cannot be read.");
        }
        try (InputStream material = Files.newInputStream(rootCertificate)) {
            if (CertificateFactory.getInstance("X.509").generateCertificates(material).isEmpty()) {
                throw new DatabaseTlsMaterialException(ROOT_CERTIFICATE + " names " + rootCertificate
                        + ", which holds no certificate.");
            }
        } catch (IOException | CertificateException failure) {
            throw new DatabaseTlsMaterialException(ROOT_CERTIFICATE + " names " + rootCertificate
                    + ", which is not readable X.509 material.", failure);
        }
        return rootCertificate;
    }
}
