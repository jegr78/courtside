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
    private static final String GSS_PARAMETER = "gssenc";
    private static final String ROOT_CERTIFICATE = "courtside.database.tls.root-certificate";
    private static final String PATH_ACTION = "Point " + ROOT_CERTIFICATE + " at the certificate"
            + " of the authority that issued the database's certificate, or set"
            + " courtside.database.tls.mode back to prefer to connect without requiring one.";
    private static final String MATERIAL_ACTION = "Restore the authority certificate at that path"
            + " from your own copy. Something wrote a file this instance cannot read, and lowering"
            + " the requirement would connect to whatever answers.";
    private static final String URL_ACTION = "Configure the pool through spring.datasource.url, or"
            + " set courtside.database.tls.mode back to prefer.";
    private static final String OVERRIDE_ACTION = "Remove it, and leave the transport to"
            + " courtside.database.tls.mode.";

    private DatabaseTls() {
    }

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

    // An argument beats the property it shares a name with, so both are read.
    private static void refuseWhatWouldDecideTheTransport(HikariDataSource dataSource) {
        for (Object property : dataSource.getDataSourceProperties().keySet()) {
            refuse(String.valueOf(property), "The connection pool carries the driver property");
        }
        String jdbcUrl = dataSource.getJdbcUrl();
        if (jdbcUrl == null) {
            throw new TlsConfigurationException("The connection pool names no JDBC URL, so"
                    + " what would decide the transport cannot be read.", URL_ACTION);
        }
        if (jdbcUrl.indexOf('?') < 0) {
            return;
        }
        for (String argument : jdbcUrl.substring(jdbcUrl.indexOf('?') + 1).split("&")) {
            refuse(argument.split("=", 2)[0], "The database connection URL carries the argument");
        }
    }

    // A service name pulls in a file of properties this guard cannot read, and GSS encryption is
    // negotiated before TLS is, so the driver never reaches the mode configured here.
    private static void refuse(String named, String carrier) {
        String name = named.toLowerCase(Locale.ROOT);
        if (name.startsWith(TRANSPORT_PARAMETER) || name.startsWith(GSS_PARAMETER)
                || name.equals(SERVICE_PARAMETER)) {
            throw new TlsConfigurationException(carrier + " '" + name + "', which overrides"
                    + " the verification " + ROOT_CERTIFICATE + " configures.", OVERRIDE_ACTION);
        }
    }

    private static Path usable(Path rootCertificate) {
        if (rootCertificate == null || rootCertificate.toString().isBlank()) {
            throw new TlsConfigurationException("Verified database TLS is configured, but "
                    + ROOT_CERTIFICATE + " names no file.", PATH_ACTION);
        }
        if (!Files.isReadable(rootCertificate)) {
            throw new TlsConfigurationException(ROOT_CERTIFICATE + " names "
                    + rootCertificate + ", which does not exist or cannot be read.", PATH_ACTION);
        }
        try (InputStream material = Files.newInputStream(rootCertificate)) {
            if (CertificateFactory.getInstance("X.509").generateCertificates(material).isEmpty()) {
                throw new TlsConfigurationException(ROOT_CERTIFICATE + " names "
                        + rootCertificate + ", which holds no certificate.", MATERIAL_ACTION);
            }
        } catch (IOException | CertificateException failure) {
            throw new TlsConfigurationException(ROOT_CERTIFICATE + " names "
                    + rootCertificate + ", which is not readable X.509 material.", MATERIAL_ACTION,
                    failure);
        }
        return rootCertificate;
    }
}
