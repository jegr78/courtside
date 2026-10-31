package org.courtside.access.internal;

import org.courtside.access.AccessControlConnector;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

import javax.net.ssl.SSLContext;
import java.net.URI;
import java.net.URISyntaxException;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.util.Locale;
import java.util.function.Supplier;
import java.util.regex.Pattern;

@Configuration(proxyBeanMethods = false)
@ConnectorSelected
class AccessControlConfiguration {

    private static final Pattern SERIAL = Pattern.compile("[0-9A-Fa-f]{12}");

    @Bean
    AccessControlConnector accessControlConnector(@Value("${courtside.access-control.connector}") String connector,
                                                  @Value("${courtside.environment:}") String designation,
                                                  @Value("${courtside.access-control.call-deadline}") Duration deadline,
                                                  Environment environment,
                                                  LoxoneGroupMapping groups, Clock clock) {
        return select(connector, designation, environment,
                new LoxoneWiring(groups, clock, deadline, AccessControlConfiguration::defaultTls));
    }

    @Bean(destroyMethod = "close")
    CallRunner accessControlCalls(@Value("${courtside.access-control.call-deadline}") Duration deadline) {
        return new CallRunner(deadline);
    }

    record LoxoneWiring(LoxoneGroupMapping groups, Clock clock, Duration callDeadline,
                        Supplier<SSLContext> tls) {
    }

    static AccessControlConnector select(String connector, String designation, Environment environment,
                                         LoxoneWiring loxone) {
        String selected = connector == null ? "" : connector.strip().toLowerCase(Locale.ROOT);
        if (LoxoneAccessControl.NAME.equals(selected)) {
            return new LoxoneAccessControl(loxoneSettings(environment, loxone), loxone.groups(), loxone.tls().get(),
                    loxone.clock());
        }
        if (!SimulatedAccessControl.NAME.equals(selected)) {
            throw new IllegalStateException("COURTSIDE_ACCESS_CONTROL_CONNECTOR names no known access-control "
                    + "system: '" + connector + "'; expected none, simulated or loxone");
        }
        boolean production = designation != null && "PRODUCTION".equalsIgnoreCase(designation.strip());
        if (production && !environment.acceptsProfiles(Profiles.of("demo"))) {
            throw new IllegalStateException("COURTSIDE_ACCESS_CONTROL_CONNECTOR=simulated hands out codes that "
                    + "open nothing and is refused in production");
        }
        return new SimulatedAccessControl();
    }

    private static LoxoneSettings loxoneSettings(Environment environment, LoxoneWiring loxone) {
        String user = required(environment, "user", "COURTSIDE_ACCESS_CONTROL_LOXONE_USER");
        String password = required(environment, "password", "COURTSIDE_ACCESS_CONTROL_LOXONE_PASSWORD");
        String serial = loxoneProperty(environment, "serial");
        String url = loxoneProperty(environment, "url");
        if (!serial.isEmpty() && !url.isEmpty()) {
            throw new IllegalStateException("COURTSIDE_ACCESS_CONTROL_LOXONE_SERIAL and "
                    + "COURTSIDE_ACCESS_CONTROL_LOXONE_URL exclude each other; set one");
        }
        LoxoneAddress address;
        if (!serial.isEmpty()) {
            if (!SERIAL.matcher(serial).matches()) {
                throw new IllegalStateException("COURTSIDE_ACCESS_CONTROL_LOXONE_SERIAL must be the Miniserver's "
                        + "serial of 12 hexadecimal digits");
            }
            address = LoxoneAddress.Serial.throughLoxoneCloud(serial.toUpperCase(Locale.ROOT));
        } else if (!url.isEmpty()) {
            address = new LoxoneAddress.Fixed(httpsUrl(url));
        } else {
            throw new IllegalStateException("COURTSIDE_ACCESS_CONTROL_CONNECTOR=loxone needs "
                    + "COURTSIDE_ACCESS_CONTROL_LOXONE_SERIAL or COURTSIDE_ACCESS_CONTROL_LOXONE_URL");
        }
        return new LoxoneSettings(address, user, password, loxone.callDeadline());
    }

    private static URI httpsUrl(String url) {
        URI parsed;
        try {
            parsed = new URI(url);
        } catch (URISyntaxException malformed) {
            parsed = null;
        }
        if (parsed == null || !"https".equalsIgnoreCase(parsed.getScheme()) || parsed.getHost() == null
                || parsed.getRawUserInfo() != null) {
            throw new IllegalStateException("COURTSIDE_ACCESS_CONTROL_LOXONE_URL must be an https:// address with a "
                    + "host");
        }
        return parsed;
    }

    private static String required(Environment environment, String key, String variable) {
        String value = loxoneProperty(environment, key);
        if (value.isEmpty()) {
            throw new IllegalStateException("COURTSIDE_ACCESS_CONTROL_CONNECTOR=loxone needs " + variable);
        }
        return value;
    }

    private static String loxoneProperty(Environment environment, String key) {
        String value = environment.getProperty("courtside.access-control.loxone." + key);
        return value == null ? "" : value.strip();
    }

    private static SSLContext defaultTls() {
        try {
            return SSLContext.getDefault();
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException("The platform's default TLS context is unavailable", unavailable);
        }
    }
}
