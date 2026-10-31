package org.courtside.access.internal;

import org.courtside.access.AccessControlConnector;
import org.courtside.config.ClubTimeZone;
import org.junit.jupiter.api.Test;
import org.springframework.boot.convert.ApplicationConversionService;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.mock.env.MockEnvironment;

import javax.net.ssl.SSLContext;
import java.net.URI;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.ZoneId;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AccessControlSelectionTest {

    private static final String SECRET = "example-loxone-secret";
    private static final AccessControlConfiguration.LoxoneWiring WIRING = new AccessControlConfiguration.LoxoneWiring(
            () -> ZoneId.of("Europe/Berlin"), accessPoint -> Optional.empty(), Clock.systemUTC(), Duration.ofSeconds(15),
            AccessControlSelectionTest::tls);

    @Test
    void givenTheSimulatedConnectorInProduction_whenItIsChosen_thenStartupFails() {
        // when / then
        assertThatThrownBy(() -> select("simulated", "PRODUCTION", new MockEnvironment()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("COURTSIDE_ACCESS_CONTROL_CONNECTOR=simulated hands out codes that open nothing and is"
                        + " refused in production");
    }

    @Test
    void givenTheSimulatedConnectorOutsideProduction_whenItIsChosen_thenItIsUsed() {
        // given
        MockEnvironment demo = new MockEnvironment();
        demo.setActiveProfiles("demo");

        // when
        var development = select(" Simulated ", "DEVELOPMENT", new MockEnvironment());
        var demoInProduction = select("simulated", "PRODUCTION", demo);

        // then
        assertThat(development).isInstanceOf(SimulatedAccessControl.class);
        assertThat(demoInProduction).as("the demo profile guards its own environment")
                .isInstanceOf(SimulatedAccessControl.class);
    }

    @Test
    void givenAnUnknownConnector_whenItIsChosen_thenStartupNamesItAndListsTheKnownOnes() {
        // when / then
        assertThatThrownBy(() -> select("nuki", "DEVELOPMENT", new MockEnvironment()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("COURTSIDE_ACCESS_CONTROL_CONNECTOR names no known access-control system: 'nuki';"
                        + " expected none, simulated or loxone");
    }

    @Test
    void givenLoxoneWithASerial_whenItIsChosenInProduction_thenItResolvesThroughTheLoxoneCloud() {
        // when
        AccessControlConnector selected = select(" Loxone ", "PRODUCTION",
                loxone().withProperty("courtside.access-control.loxone.serial", "504F94A0EE01"));

        // then
        assertThat(selected).isInstanceOf(LoxoneAccessControl.class);
        assertThat(((LoxoneAccessControl) selected).address())
                .isEqualTo(LoxoneAddress.Serial.throughLoxoneCloud("504F94A0EE01"));
        ((LoxoneAccessControl) selected).close();
    }

    @Test
    void givenLoxoneWithAUrl_whenItIsChosen_thenThatAddressIsUsed() {
        // when
        AccessControlConnector selected = select("loxone", "PRODUCTION", loxone().withProperty(
                "courtside.access-control.loxone.url", "https://192-168-1-47.504F94A0EE01.dyndns.loxonecloud.com:443"));

        // then
        assertThat(((LoxoneAccessControl) selected).address()).isEqualTo(new LoxoneAddress.Fixed(
                URI.create("https://192-168-1-47.504F94A0EE01.dyndns.loxonecloud.com:443")));
        ((LoxoneAccessControl) selected).close();
    }

    @Test
    void givenLoxoneWithoutAUser_whenItIsChosen_thenStartupNamesTheVariable() {
        // when / then
        assertRefused(loxone().withProperty("courtside.access-control.loxone.serial", "504F94A0EE01")
                        .withProperty("courtside.access-control.loxone.user", " "),
                "COURTSIDE_ACCESS_CONTROL_CONNECTOR=loxone needs COURTSIDE_ACCESS_CONTROL_LOXONE_USER");
    }

    @Test
    void givenLoxoneWithoutAPassword_whenItIsChosen_thenStartupNamesTheVariable() {
        // when / then
        assertRefused(new MockEnvironment().withProperty("courtside.access-control.loxone.user", "courtside")
                        .withProperty("courtside.access-control.loxone.serial", "504F94A0EE01"),
                "COURTSIDE_ACCESS_CONTROL_CONNECTOR=loxone needs COURTSIDE_ACCESS_CONTROL_LOXONE_PASSWORD");
    }

    @Test
    void givenLoxoneWithoutAnAddress_whenItIsChosen_thenStartupNamesBothVariables() {
        // when / then
        assertRefused(loxone(), "COURTSIDE_ACCESS_CONTROL_CONNECTOR=loxone needs COURTSIDE_ACCESS_CONTROL_LOXONE_SERIAL"
                + " or COURTSIDE_ACCESS_CONTROL_LOXONE_URL");
    }

    @Test
    void givenLoxoneWithBothAddresses_whenItIsChosen_thenStartupRefusesTheConflict() {
        // when / then
        assertRefused(loxone().withProperty("courtside.access-control.loxone.serial", "504F94A0EE01")
                        .withProperty("courtside.access-control.loxone.url", "https://miniserver.example.org"),
                "COURTSIDE_ACCESS_CONTROL_LOXONE_SERIAL and COURTSIDE_ACCESS_CONTROL_LOXONE_URL exclude each other;"
                        + " set one");
    }

    @Test
    void givenLoxoneWithAnHttpUrl_whenItIsChosen_thenStartupRefusesIt() {
        // when / then
        assertRefused(loxone().withProperty("courtside.access-control.loxone.url", "http://miniserver.example.org"),
                "COURTSIDE_ACCESS_CONTROL_LOXONE_URL must be an https:// address with a host");
    }

    @Test
    void givenLoxoneWithAMalformedSerial_whenItIsChosen_thenStartupRefusesIt() {
        // when / then
        assertRefused(loxone().withProperty("courtside.access-control.loxone.serial", "504F94A0EE01/x"),
                "COURTSIDE_ACCESS_CONTROL_LOXONE_SERIAL must be the Miniserver's serial of 12 hexadecimal digits");
    }

    @Test
    void givenASelectedLoxoneConnector_whenTheContextCloses_thenTheConnectorIsClosed() {
        // given
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        MockEnvironment environment = loxone().withProperty("courtside.access-control.connector", "loxone")
                .withProperty("courtside.access-control.call-deadline", "15s")
                .withProperty("courtside.access-control.loxone.url", "https://miniserver.example.org");
        context.setEnvironment(environment);
        context.getBeanFactory().setConversionService(ApplicationConversionService.getSharedInstance());
        context.registerBean(ClubTimeZone.class, () -> () -> ZoneId.of("Europe/Berlin"));
        context.registerBean(LoxoneGroupMapping.class, () -> accessPoint -> Optional.empty());
        context.registerBean(Clock.class, Clock::systemUTC);
        context.register(AccessControlConfiguration.class);
        context.refresh();
        LoxoneAccessControl connector = (LoxoneAccessControl) context.getBean(AccessControlConnector.class);

        // when
        context.close();

        // then
        assertThat(connector.closed()).as("closing the context closes the connector").isTrue();
    }

    private static MockEnvironment loxone() {
        return new MockEnvironment().withProperty("courtside.access-control.loxone.user", "courtside")
                .withProperty("courtside.access-control.loxone.password", SECRET);
    }

    private static void assertRefused(MockEnvironment environment, String message) {
        assertThatThrownBy(() -> select("loxone", "PRODUCTION", environment))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage(message)
                .message().doesNotContain(SECRET);
    }

    private static AccessControlConnector select(String connector, String designation, MockEnvironment environment) {
        return AccessControlConfiguration.select(connector, designation, environment, WIRING);
    }

    private static SSLContext tls() {
        try {
            return SSLContext.getDefault();
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("the default TLS context is unavailable", unavailable);
        }
    }
}
