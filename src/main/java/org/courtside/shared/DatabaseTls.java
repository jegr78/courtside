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
    private static final String SERVICE_PARAMETER = "service";
    private static final String ROOT_CERTIFICATE = "courtside.database.tls.root-certificate";
    private static final String ANCHOR_ACTION = "Point " + ROOT_CERTIFICATE + " at the certificate"
            + " of the authority that issued the database's certificate, or set"
            + " courtside.database.tls.mode back to prefer to connect without requiring one.";
    private static final String OVERRIDE_ACTION = "Remove it, and leave the transport to"
            + " courtside.database.tls.mode.";

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
        Path anchor = usable(rootCertificate);
        refuseWhatWouldDecideTheTransport(dataSource);
        dataSource.addDataSourceProperty("sslmode", VERIFY_FULL);
        dataSource.addDataSourceProperty("sslrootcert", anchor.toString());
    }

    // The driver takes the transport from a URL argument and from a pool property alike, and an
    // argument beats the property, so either one could turn verification off without saying so.
    private static void refuseWhatWouldDecideTheTransport(HikariDataSource dataSource) {
        for (Object property : dataSource.getDataSourceProperties().keySet()) {
            refuse(String.valueOf(property), "The connection pool carries the driver property");
        }
        String jdbcUrl = dataSource.getJdbcUrl();
        if (jdbcUrl == null || jdbcUrl.indexOf('?') < 0) {
            return;
        }
        for (String argument : jdbcUrl.substring(jdbcUrl.indexOf('?') + 1).split("&")) {
            refuse(argument.split("=", 2)[0], "The database connection URL carries the argument");
        }
    }

    // A service name reaches the driver as an ordinary word and pulls in a file of properties this
    // guard cannot read, among them the socket factory that decides whether the anchor is used.
    private static void refuse(String named, String carrier) {
        String name = named.toLowerCase(Locale.ROOT);
        if (name.startsWith(TRANSPORT_PARAMETER) || name.equals(SERVICE_PARAMETER)) {
            throw new DatabaseTlsConfigurationException(carrier + " '" + name + "', which overrides"
                    + " the verification " + ROOT_CERTIFICATE + " configures.", OVERRIDE_ACTION);
        }
    }

    private static Path usable(Path rootCertificate) {
        if (rootCertificate == null || rootCertificate.toString().isBlank()) {
            throw new DatabaseTlsConfigurationException("Verified database TLS is configured, but "
                    + ROOT_CERTIFICATE + " names no file.", ANCHOR_ACTION);
        }
        if (!Files.isReadable(rootCertificate)) {
            throw new DatabaseTlsConfigurationException(ROOT_CERTIFICATE + " names "
                    + rootCertificate + ", which does not exist or cannot be read.", ANCHOR_ACTION);
        }
        try (InputStream material = Files.newInputStream(rootCertificate)) {
            if (CertificateFactory.getInstance("X.509").generateCertificates(material).isEmpty()) {
                throw new DatabaseTlsConfigurationException(ROOT_CERTIFICATE + " names "
                        + rootCertificate + ", which holds no certificate.", ANCHOR_ACTION);
            }
        } catch (IOException | CertificateException failure) {
            throw new DatabaseTlsConfigurationException(ROOT_CERTIFICATE + " names "
                    + rootCertificate + ", which is not readable X.509 material.", ANCHOR_ACTION,
                    failure);
        }
        return rootCertificate;
    }
}
