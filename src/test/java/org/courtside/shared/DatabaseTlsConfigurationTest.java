package org.courtside.shared;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.courtside.TestCertificate;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class DatabaseTlsConfigurationTest {

    private static final String URL = "jdbc:postgresql://db:5432/courtside";

    @Test
    void givenAnAuthority_whenTheVerifiedPoolStarts_thenItCarriesTheAnchorAndFullVerification()
            throws Exception {
        // given
        Path authority = anchor(TestCertificate.issuedFor("db").authority());

        // when / then
        verified(authority, URL).run(context -> {
            assertThat(context).hasNotFailed();
            HikariDataSource pool = context.getBean(HikariDataSource.class);
            assertThat(pool.getDataSourceProperties())
                    .containsEntry("sslmode", "verify-full")
                    .containsEntry("sslrootcert", authority.toString());
        });
    }

    @Test
    void givenNoAnchor_whenTheVerifiedPoolStarts_thenItRefusesAndNamesTheProperty() {
        // when / then
        new ApplicationContextRunner()
                .withUserConfiguration(DatabaseTlsConfiguration.class)
                .withBean(HikariDataSource.class, () -> pool(URL))
                .withPropertyValues("courtside.database.tls.mode=verify-full")
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("courtside.database.tls.root-certificate")
                        .hasMessageContaining("names no file"));
    }

    @Test
    void givenAnAnchorThatIsNotThere_whenTheVerifiedPoolStarts_thenItRefusesAndNamesTheFile() {
        // given
        Path absent = Path.of("build", "no-such-authority.pem");

        // when / then
        verified(absent, URL).run(context -> assertThat(refusalIn(context.getStartupFailure()))
                .hasMessageContaining(absent.toString())
                .hasMessageContaining("does not exist or cannot be read"));
    }

    @Test
    void givenAFileThatIsNoCertificate_whenTheVerifiedPoolStarts_thenItRefusesTheMaterial()
            throws Exception {
        // given
        Path notMaterial = Files.writeString(
                Files.createTempFile("courtside-anchor-", ".pem"), "no certificate lives here\n");

        // when / then
        verified(notMaterial, URL).run(context -> assertThat(refusalIn(context.getStartupFailure()))
                .hasMessageContaining(notMaterial.toString())
                .hasMessageContaining("is not readable X.509 material"));
    }

    @Test
    void givenAnEmptyAnchor_whenTheVerifiedPoolStarts_thenItRefusesTheEmptyMaterial()
            throws Exception {
        // given
        Path empty = Files.createTempFile("courtside-anchor-", ".pem");

        // when / then
        verified(empty, URL).run(context -> assertThat(refusalIn(context.getStartupFailure()))
                .hasMessageContaining(empty.toString())
                .hasMessageContaining("holds no certificate"));
    }

    // The driver lets a URL argument beat the pool's own property, so a URL that names the
    // transport is one of two inputs that could turn verification back off without saying so.
    @Test
    void givenAUrlThatNamesTheTransport_whenTheVerifiedPoolStarts_thenItRefusesAndNamesTheArgument()
            throws Exception {
        // given
        Path authority = anchor(TestCertificate.issuedFor("db").authority());

        // when / then
        verified(authority, URL + "?sslmode=disable")
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("sslmode")
                        .hasMessageContaining("overrides the verification"));
    }

    // The other one, and the one no URL check would see: the factory the driver builds its socket
    // with is chosen independently of the mode, and one of the driver's own verifies nothing.
    @Test
    void givenAPoolPropertyThatNamesTheTransport_whenTheVerifiedPoolStarts_thenItRefusesTheProperty()
            throws Exception {
        // given
        Path authority = anchor(TestCertificate.issuedFor("db").authority());

        // when / then
        new ApplicationContextRunner()
                .withUserConfiguration(DatabaseTlsConfiguration.class)
                .withBean(HikariDataSource.class, () -> unverifying(pool(URL)))
                .withPropertyValues("courtside.database.tls.mode=verify-full",
                        "courtside.database.tls.root-certificate=" + authority)
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("sslfactory")
                        .hasMessageContaining("overrides the verification"));
    }

    // The driver reads the named service file into the same properties, and what it may set there
    // includes the socket factory, so the one argument that carries no `ssl` in its name is refused too.
    @Test
    void givenAUrlThatNamesAServiceFile_whenTheVerifiedPoolStarts_thenItRefusesTheArgument()
            throws Exception {
        // given
        Path authority = anchor(TestCertificate.issuedFor("db").authority());

        // when / then
        verified(authority, URL + "?service=courtside")
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("service")
                        .hasMessageContaining("overrides the verification"));
    }

    // A property whose value binds to something other than a string — a digit-only password, say —
    // is invisible to the properties' own string view and would pass a scan built on it.
    @Test
    void givenAPoolPropertyThatIsNoString_whenTheVerifiedPoolStarts_thenItIsSeenAllTheSame()
            throws Exception {
        // given
        Path authority = anchor(TestCertificate.issuedFor("db").authority());

        // when / then
        new ApplicationContextRunner()
                .withUserConfiguration(DatabaseTlsConfiguration.class)
                .withBean(HikariDataSource.class, () -> numeric(pool(URL)))
                .withPropertyValues("courtside.database.tls.mode=verify-full",
                        "courtside.database.tls.root-certificate=" + authority)
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("sslpassword"));
    }

    // GSS encryption is negotiated before TLS is, and the driver then never reaches the mode
    // configured here, so the argument that carries no `ssl` at all is refused as well.
    @Test
    void givenAUrlThatNamesGssEncryption_whenTheVerifiedPoolStarts_thenItRefusesTheArgument()
            throws Exception {
        // given
        Path authority = anchor(TestCertificate.issuedFor("db").authority());

        // when / then
        verified(authority, URL + "?gssEncMode=require")
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("gssencmode")
                        .hasMessageContaining("overrides the verification"));
    }

    // The scan reads what the pool already carries, so it depends on running after the binding
    // that puts an operator's driver properties there.
    @Test
    void givenAnOperatorSetDriverProperty_whenTheVerifiedPoolStarts_thenTheBindingIsSeen()
            throws Exception {
        // given
        Path authority = anchor(TestCertificate.issuedFor("db").authority());

        // when / then
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(DataSourceAutoConfiguration.class))
                .withUserConfiguration(DatabaseTlsConfiguration.class)
                .withPropertyValues("spring.datasource.url=" + URL,
                        "spring.datasource.hikari.data-source-properties.sslfactory="
                                + "org.postgresql.ssl.NonValidatingFactory",
                        "courtside.database.tls.mode=verify-full",
                        "courtside.database.tls.root-certificate=" + authority)
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("sslfactory"));
    }

    // A pool configured through a data-source class carries no URL, and the one channel this
    // guard cannot read is the one its own policy says to refuse.
    @Test
    void givenAPoolWithoutAUrl_whenVerificationIsRequired_thenTheStartIsRefused() throws Exception {
        // given
        Path authority = anchor(TestCertificate.issuedFor("db").authority());

        // when / then
        verified(authority, null)
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("names no JDBC URL"));
    }

    // A path nobody set is this instance's own mistake. A file that is there and unreadable is
    // not, so only the first names the mode an operator could lower.
    @Test
    void givenAnEmptyAnchor_whenItIsReported_thenTheActionDoesNotOfferToLowerTheMode()
            throws Exception {
        // given
        Path empty = Files.createTempFile("courtside-anchor-", ".pem");

        // when / then
        verified(empty, URL).run(context ->
                assertThat(refusalIn(context.getStartupFailure()).action())
                        .contains("Restore the authority certificate")
                        .doesNotContain("prefer"));
    }

    // Every other way to get this wrong refuses the start, and a requirement that reached no pool
    // would connect exactly as prefer does while the configuration says it verifies.
    @Test
    void givenNoPoolAtAll_whenVerificationIsRequired_thenTheStartIsRefusedRatherThanUnenforced()
            throws Exception {
        // given
        Path authority = anchor(TestCertificate.issuedFor("db").authority());

        // when / then
        new ApplicationContextRunner()
                .withUserConfiguration(DatabaseTlsConfiguration.class)
                .withPropertyValues("courtside.database.tls.mode=verify-full",
                        "courtside.database.tls.root-certificate=" + authority)
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("no connection pool was configured with it"));
    }

    // The driver encrypts opportunistically on its own, so leaving it alone is a mode of its own
    // and not the same answer as refusing encryption.
    @Test
    void givenThePreferredMode_whenThePoolStarts_thenTheDriverIsLeftToItself() {
        // when / then
        inMode("prefer").run(context -> assertThat(context.getBean(HikariDataSource.class)
                .getDataSourceProperties()).isEmpty());
    }

    @Test
    void givenTheDisabledMode_whenThePoolStarts_thenTheTransportIsRefusedOutright() {
        // when / then
        inMode("disable").run(context -> assertThat(context.getBean(HikariDataSource.class)
                .getDataSourceProperties()).containsEntry("sslmode", "disable"));
    }

    private static ApplicationContextRunner inMode(String mode) {
        return new ApplicationContextRunner()
                .withUserConfiguration(DatabaseTlsConfiguration.class)
                .withBean(HikariDataSource.class, () -> pool(URL))
                .withPropertyValues("courtside.database.tls.mode=" + mode);
    }

    private static TlsConfigurationException refusalIn(Throwable failure) {
        for (Throwable step = failure; step != null && step != step.getCause();
                step = step.getCause()) {
            if (step instanceof TlsConfigurationException refusal) {
                return refusal;
            }
        }
        throw new AssertionError("The context did not fail on the database TLS configuration: " + failure);
    }

    private static ApplicationContextRunner verified(Path authority, String url) {
        return new ApplicationContextRunner()
                .withUserConfiguration(DatabaseTlsConfiguration.class)
                .withBean(HikariDataSource.class, () -> pool(url))
                .withPropertyValues("courtside.database.tls.mode=verify-full",
                        "courtside.database.tls.root-certificate=" + authority);
    }

    private static HikariDataSource numeric(HikariDataSource dataSource) {
        dataSource.addDataSourceProperty("sslpassword", 1234);
        return dataSource;
    }

    private static HikariDataSource unverifying(HikariDataSource dataSource) {
        dataSource.addDataSourceProperty("sslfactory", "org.postgresql.ssl.NonValidatingFactory");
        return dataSource;
    }

    private static HikariDataSource pool(String url) {
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl(url);
        return dataSource;
    }

    private static Path anchor(String authority) throws Exception {
        return Files.writeString(Files.createTempFile("courtside-anchor-", ".pem"), authority);
    }
}
