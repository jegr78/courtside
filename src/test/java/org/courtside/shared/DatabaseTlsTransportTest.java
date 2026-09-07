package org.courtside.shared;

import org.courtside.TestCertificate;
import org.courtside.TestPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.Banner;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.boot.diagnostics.FailureAnalysis;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mock.env.MockEnvironment;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.nio.file.Files;
import java.security.cert.CertificateNotYetValidException;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

@ExtendWith(OutputCaptureExtension.class)
class DatabaseTlsTransportTest {

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
                .contains("the database offered no encryption at all");
    }

    // Suppressing the handshake produces exactly this refusal, so an action that offered the
    // preferred mode here would talk whoever suppressed it through finishing the job.
    @Test
    void givenADatabaseWithoutTls_whenItIsDiagnosed_thenTheActionDoesNotOfferToLowerTheMode()
            throws Exception {
        // given
        PostgreSQLContainer plaintext = TestPostgres.sharedPlaintext();

        // when
        SQLException refusal = refusalOf(plaintext.getJdbcUrl(), anchor(served.authority()));

        // then
        assertThat(diagnosis(refusal).getAction())
                .contains("Turn TLS on at the database")
                .doesNotContain("prefer");
    }

    // Both extend CertificateException, and an operator sent after the wrong one looks for a
    // certificate nobody mis-issued instead of at two clocks.
    @Test
    void givenACertificateThatIsNotValidYet_whenItIsDiagnosed_thenItIsNotReportedAsAWrongAuthority() {
        // given
        SQLException refusal = new SQLException("SSL error", "08006",
                new CertificateNotYetValidException("NotBefore lies ahead"));

        // when / then
        assertThat(diagnosis(refusal).getDescription()).contains("is not valid yet");
    }

    // The pool can wrap what the driver said in an exception carrying no state at all, and an
    // analyzer that throws is one Boot swallows: the operator gets the stack trace instead.
    @Test
    void givenAFailureWithoutASqlState_whenItIsDiagnosed_thenTheAnalyzerStaysSilent() {
        // when / then
        assertThat(diagnosis(new SQLException("Failed to initialize pool"))).isNull();
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
    void givenThePreferredMode_whenTheConfiguredPoolConnects_thenTheDriverEncryptsWithoutVerifying() {
        // when / then
        new ApplicationContextRunner()
                .withUserConfiguration(DatabaseTlsConfiguration.class)
                .withBean(HikariDataSource.class, () -> pool(database.getJdbcUrl()))
                .withPropertyValues("courtside.database.tls.mode=prefer")
                .run(context -> assertThat(encrypted(context.getBean(HikariDataSource.class)))
                        .isTrue());
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

    // The same database serving the same certificate: what changes is the mode an operator chose.
    @Test
    void givenTheDisabledMode_whenTheConfiguredPoolConnects_thenTheConnectionCarriesNoTls() {
        // when / then
        new ApplicationContextRunner()
                .withUserConfiguration(DatabaseTlsConfiguration.class)
                .withBean(HikariDataSource.class, () -> pool(database.getJdbcUrl()))
                .withPropertyValues("courtside.database.tls.mode=disable")
                .run(context -> assertThat(encrypted(context.getBean(HikariDataSource.class)))
                        .isFalse());
    }

    private static boolean encrypted(HikariDataSource dataSource) throws SQLException {
        try (var connection = dataSource.getConnection();
             var statement = connection.createStatement();
             var rows = statement.executeQuery(
                     "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")) {
            rows.next();
            return rows.getBoolean(1);
        }
    }

    // Handing the analyzer an exception proves how it classifies one. Only a real start proves
    // that the `spring.factories` line and the wiring put its sentence in front of an operator.
    @Test
    void givenAnAuthorityThatDoesNotVouch_whenTheApplicationStarts_thenTheReportSaysSo(
            CapturedOutput output) throws Exception {
        // given
        Path unrelated = anchor(TestCertificate.issuedFor("localhost").authority());

        // when
        Throwable failure = catchThrowable(() -> new SpringApplicationBuilder(ConnectingPool.class)
                .web(WebApplicationType.NONE)
                .bannerMode(Banner.Mode.OFF)
                .run("--courtside.database.tls.mode=verify-full",
                        "--courtside.database.tls.root-certificate=" + unrelated));

        // then
        assertThat(failure).isNotNull();
        assertThat(output.getOut())
                .contains("APPLICATION FAILED TO START")
                .contains("does not vouch for the certificate the database served");
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

    @Configuration(proxyBeanMethods = false)
    @Import(DatabaseTlsConfiguration.class)
    static class ConnectingPool {

        @Bean
        HikariDataSource pool() {
            return DatabaseTlsTransportTest.pool(database.getJdbcUrl());
        }

        // The pool opens nothing until something asks it to, and a start that never connects
        // proves nothing about what a failed connection reports.
        @Bean
        InitializingBean reachTheDatabase(HikariDataSource pool) {
            return () -> pool.getConnection().close();
        }
    }
}
