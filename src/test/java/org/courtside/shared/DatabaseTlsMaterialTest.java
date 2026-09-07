package org.courtside.shared;

import com.zaxxer.hikari.HikariDataSource;
import org.courtside.TestCertificate;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class DatabaseTlsMaterialTest {

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
    // transport is the one input that could turn verification back off without saying so.
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

    private static DatabaseTlsMaterialException refusalIn(Throwable failure) {
        for (Throwable step = failure; step != null && step != step.getCause();
                step = step.getCause()) {
            if (step instanceof DatabaseTlsMaterialException refusal) {
                return refusal;
            }
        }
        throw new AssertionError("The context did not fail on the database TLS material: " + failure);
    }

    private static ApplicationContextRunner verified(Path authority, String url) {
        return new ApplicationContextRunner()
                .withUserConfiguration(DatabaseTlsConfiguration.class)
                .withBean(HikariDataSource.class, () -> pool(url))
                .withPropertyValues("courtside.database.tls.mode=verify-full",
                        "courtside.database.tls.root-certificate=" + authority);
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
