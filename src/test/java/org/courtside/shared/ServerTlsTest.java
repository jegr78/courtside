package org.courtside.shared;

import org.courtside.TestCertificate;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.ConfigurableWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.core.env.SystemEnvironmentPropertySource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ServerTlsTest {

    @Test
    void givenNoCertificate_whenTheServingModeIsSet_thenItRefusesAndNamesTheProperty() {
        // when / then
        serving(null, null).run(context -> assertThat(refusalIn(context.getStartupFailure()))
                .hasMessageContaining("courtside.server.tls.certificate")
                .hasMessageContaining("names no file"));
    }

    @Test
    void givenACertificateThatIsNotThere_whenTheServingModeIsSet_thenItRefusesAndNamesTheFile()
            throws Exception {
        // given
        Path absent = Path.of("build", "no-such-certificate.pem");
        Path key = written(TestCertificate.issuedFor("app").key());

        // when / then
        serving(absent, key).run(context -> assertThat(refusalIn(context.getStartupFailure()))
                .hasMessageContaining(absent.toString())
                .hasMessageContaining("does not exist or cannot be read"));
    }

    @Test
    void givenAFileThatIsNoCertificate_whenTheServingModeIsSet_thenItRefusesTheMaterial()
            throws Exception {
        // given
        TestCertificate served = TestCertificate.issuedFor("app");
        Path notACertificate = written("no certificate lives here\n");

        // when / then
        serving(notACertificate, written(served.key()))
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("is not readable X.509 material")
                        .satisfies(refusal -> assertThat(refusal.action())
                                .contains("Restore that file").doesNotContain("plaintext")));
    }

    // The two files are told apart by what they hold, so the certificate handed in twice -- the
    // mistake a copied command makes -- is named as the missing key rather than accepted.
    @Test
    void givenTheCertificateInPlaceOfTheKey_whenTheServingModeIsSet_thenItRefusesTheKey()
            throws Exception {
        // given
        TestCertificate served = TestCertificate.issuedFor("app");
        Path certificate = written(served.certificate());

        // when / then
        serving(certificate, certificate)
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("courtside.server.tls.private-key")
                        .hasMessageContaining("holds no private key"));
    }

    // An operator sets this as SERVER_SSL_ENABLED in the environment, and only relaxed binding
    // turns that into the dotted name a scan over raw property names would look for.
    @Test
    void givenSpringsOwnSslConfiguration_whenTheServingModeIsSet_thenItRefusesTheConfiguration()
            throws Exception {
        // given
        TestCertificate served = TestCertificate.issuedFor("app");

        // when / then
        serving(written(served.certificate()), written(served.key()))
                .withInitializer(context -> context.getEnvironment().getPropertySources()
                        .addFirst(new SystemEnvironmentPropertySource("systemEnvironment",
                                Map.of("SERVER_SSL_ENABLED", "false"))))
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("server.ssl")
                        .hasMessageContaining("would decide what it serves"));
    }

    @Test
    void givenSpringsOwnSslProperty_whenTheServingModeIsSet_thenItRefusesTheProperty()
            throws Exception {
        // given
        TestCertificate served = TestCertificate.issuedFor("app");

        // when / then
        serving(written(served.certificate()), written(served.key()))
                .withPropertyValues("server.ssl.enabled=false")
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("server.ssl")
                        .hasMessageContaining("would decide what it serves"));
    }

    @Test
    void givenAnExpiredCertificate_whenTheServingModeIsSet_thenItRefusesAndAsksForRenewal()
            throws Exception {
        // given
        TestCertificate ranOut = TestCertificate.expiredFor("app");

        // when / then
        serving(written(ranOut.certificate()), written(ranOut.key()))
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("expired on")
                        .satisfies(refusal -> assertThat(refusal.action()).contains("Renew")));
    }

    // Two clocks disagreeing is a different repair from a certificate that ran out, so the two are
    // told apart rather than reported as one unusable file.
    @Test
    void givenACertificateThatIsNotValidYet_whenTheServingModeIsSet_thenItRefusesAndNamesTheClock()
            throws Exception {
        // given
        TestCertificate future = TestCertificate.notYetValidFor("app");

        // when / then
        serving(written(future.certificate()), written(future.key()))
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("valid from")
                        .satisfies(refusal -> assertThat(refusal.action()).contains("clock")));
    }

    // OpenSSL writes an encrypted key in two encodings, and the traditional one carries no
    // ENCRYPTED in its label -- it says so in a header line instead.
    @Test
    void givenATraditionallyEncryptedKey_whenTheServingModeIsSet_thenItRefusesTheKey()
            throws Exception {
        // given
        TestCertificate served = TestCertificate.issuedFor("app");
        Path locked = written(TestCertificate.encryptedTraditionally(served.key(), "example"));

        // when / then
        serving(written(served.certificate()), locked)
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("password-protected private key"));
    }

    // A key the operator protected with a password is one nothing here can open, and Tomcat would
    // report that as an unreadable key rather than as the password it is missing.
    @Test
    void givenAPasswordProtectedKey_whenTheServingModeIsSet_thenItRefusesTheKey() throws Exception {
        // given
        TestCertificate served = TestCertificate.issuedFor("app");
        Path locked = written(TestCertificate.encrypted(served.key(), "example"));

        // when / then
        serving(written(served.certificate()), locked)
                .run(context -> assertThat(refusalIn(context.getStartupFailure()))
                        .hasMessageContaining("password-protected private key")
                        .satisfies(refusal -> assertThat(refusal.action())
                                .contains("without a password")));
    }

    // The material check runs wherever the application is configured; what a web server serves is
    // decided by the customizer, and only a factory passed through it carries the material.
    @Test
    void givenTheServingMode_whenAWebServerIsBuilt_thenTheCustomizerCarriesTheMaterial()
            throws Exception {
        // given
        TestCertificate served = TestCertificate.issuedFor("app");
        Path certificate = written(served.certificate());
        Path key = written(served.key());

        // when / then
        serving(certificate, key).run(context -> {
            ConfigurableWebServerFactory factory = new TomcatServletWebServerFactory();
            context.getBean(WebServerFactoryCustomizer.class).customize(factory);
            assertThat(factory).extracting("ssl").hasFieldOrPropertyWithValue("enabled", true)
                    .hasFieldOrPropertyWithValue("certificate", certificate.toString())
                    .hasFieldOrPropertyWithValue("certificatePrivateKey", key.toString());
        });
    }

    // Plaintext is the default and asks for no material, so an instance that never opted in must
    // not be refused for material it was never told to have.
    @Test
    void givenThePlaintextMode_whenNoMaterialIsConfigured_thenNothingIsRefused() {
        // when / then
        new ApplicationContextRunner()
                .withUserConfiguration(ServerTlsConfiguration.class)
                .withPropertyValues("courtside.server.tls.mode=plaintext")
                .run(context -> assertThat(context).hasNotFailed());
    }

    private static ApplicationContextRunner serving(Path certificate, Path key) {
        return new ApplicationContextRunner()
                .withUserConfiguration(ServerTlsConfiguration.class)
                .withPropertyValues("courtside.server.tls.mode=serve",
                        "courtside.server.tls.certificate=" + (certificate == null ? "" : certificate),
                        "courtside.server.tls.private-key=" + (key == null ? "" : key));
    }

    private static TlsConfigurationException refusalIn(Throwable failure) {
        for (Throwable step = failure; step != null && step != step.getCause();
                step = step.getCause()) {
            if (step instanceof TlsConfigurationException refusal) {
                return refusal;
            }
        }
        throw new AssertionError("The context did not fail on the server TLS material: " + failure);
    }

    private static Path written(String material) throws Exception {
        return Files.writeString(Files.createTempFile("courtside-server-", ".pem"), material);
    }
}
