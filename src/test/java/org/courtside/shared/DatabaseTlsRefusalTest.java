package org.courtside.shared;

import org.courtside.TestCertificate;
import org.courtside.TestPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.boot.diagnostics.FailureAnalysis;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mock.env.MockEnvironment;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

class DatabaseTlsRefusalTest {

    private static TestCertificate served;
    private static PostgreSQLContainer database;

    @BeforeAll
    static void startTheDatabase() throws Exception {
        served = TestCertificate.issuedFor("localhost");
        database = TestPostgres.serving(served);
        database.start();
    }

    @AfterAll
    static void stopTheDatabase() {
        database.stop();
    }

    @Test
    void givenAnotherAuthority_whenConnecting_thenTheDiagnosisSaysTheAnchorDoesNotVouchForIt()
            throws Exception {
        // given
        Path unrelated = anchor(TestCertificate.issuedFor("localhost").authority());

        // when
        SQLException refusal = refusalOf(database.getJdbcUrl(), unrelated);

        // then
        assertThat(diagnosis(refusal).getDescription())
                .contains("does not vouch for the certificate the database served");
    }

    @Test
    void givenACertificateForAnotherHost_whenConnecting_thenTheDiagnosisSaysSo() throws Exception {
        // given
        Path trusted = anchor(served.authority());

        // when
        SQLException refusal = refusalOf(
                database.getJdbcUrl().replace("localhost", "127.0.0.1"), trusted);

        // then
        assertThat(diagnosis(refusal).getDescription())
                .contains("names another host");
    }

    @Test
    void givenAnExpiredCertificate_whenConnecting_thenTheDiagnosisSaysItRanOut() throws Exception {
        // given
        TestCertificate spent = TestCertificate.expiredFor("localhost");

        // when
        SQLException refusal;
        try (PostgreSQLContainer expired = TestPostgres.serving(spent)) {
            expired.start();
            refusal = refusalOf(expired.getJdbcUrl(), anchor(spent.authority()));
        }

        // then
        assertThat(diagnosis(refusal).getDescription())
                .contains("has expired");
    }

    // Verification that quietly accepts a server offering none is the fallback this path forbids.
    @Test
    void givenADatabaseWithoutTls_whenConnectingWithVerification_thenItIsRefusedRatherThanDowngraded()
            throws Exception {
        // given
        PostgreSQLContainer plaintext = TestPostgres.sharedPlaintext();

        // when
        SQLException refusal = refusalOf(plaintext.getJdbcUrl(), anchor(served.authority()));

        // then
        assertThat(refusal.getMessage()).contains("does not support SSL");
        assertThat(diagnosis(refusal).getDescription())
                .contains("The database connection requires a verified TLS certificate");
    }

    @Test
    void givenVerificationIsOff_whenADatabaseFailureIsAnalysed_thenTheAnalyzerStaysSilent()
            throws Exception {
        // given
        SQLException refusal = refusalOf(database.getJdbcUrl(),
                anchor(TestCertificate.issuedFor("localhost").authority()));

        // when
        FailureAnalysis silence = new DatabaseTlsHandshakeFailureAnalyzer(
                new MockEnvironment().withProperty("courtside.database.tls.mode", "disable"))
                .analyze(refusal);

        // then
        assertThat(silence).isNull();
    }

    // What the preferred mode leaves in place: encryption the driver takes when it is offered,
    // and no verification of who offered it.
    @Test
    void givenNoConfiguredTransport_whenConnecting_thenTheDriverEncryptsWithoutVerifying()
            throws Exception {
        // given
        Properties unconfigured = new Properties();
        unconfigured.setProperty("user", database.getUsername());
        unconfigured.setProperty("password", database.getPassword());

        // when / then
        try (var connection = DriverManager.getConnection(database.getJdbcUrl(), unconfigured);
             var statement = connection.createStatement();
             var rows = statement.executeQuery(
                     "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")) {
            rows.next();
            assertThat(rows.getBoolean(1)).isTrue();
        }
    }

    // Through the configuration the application really uses, so the mode this sets has to be the
    // one that checks the name and not merely one that encrypts.
    @Test
    void givenTheConfiguredPool_whenTheNameDoesNotMatch_thenTheConnectionIsRefused()
            throws Exception {
        // given
        String otherName = database.getJdbcUrl().replace("localhost", "127.0.0.1");

        // when / then
        new ApplicationContextRunner()
                .withUserConfiguration(DatabaseTlsConfiguration.class)
                .withBean(HikariDataSource.class, () -> pool(otherName))
                .withPropertyValues("courtside.database.tls.mode=verify-full",
                        "courtside.database.tls.root-certificate=" + anchor(served.authority()))
                .run(context -> assertThatThrownBy(
                        () -> context.getBean(HikariDataSource.class).getConnection())
                        .hasStackTraceContaining("PgjdbcHostnameVerifier"));
    }

    private static HikariDataSource pool(String url) {
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl(url);
        dataSource.setUsername(database.getUsername());
        dataSource.setPassword(database.getPassword());
        dataSource.setConnectionTimeout(2000);
        return dataSource;
    }

    private static FailureAnalysis diagnosis(SQLException refusal) {
        return new DatabaseTlsHandshakeFailureAnalyzer(new MockEnvironment()
                .withProperty("courtside.database.tls.mode", "verify-full"))
                .analyze(refusal);
    }

    private static SQLException refusalOf(String url, Path authority) {
        Properties properties = new Properties();
        properties.setProperty("user", database.getUsername());
        properties.setProperty("password", database.getPassword());
        properties.setProperty("sslmode", "verify-full");
        properties.setProperty("sslrootcert", authority.toString());
        return catchThrowableOfType(SQLException.class,
                () -> DriverManager.getConnection(url, properties));
    }

    private static Path anchor(String authority) throws Exception {
        return Files.writeString(Files.createTempFile("courtside-anchor-", ".pem"), authority);
    }
}
