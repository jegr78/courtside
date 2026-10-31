package org.courtside.access.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import javax.net.ssl.SSLContext;
import java.net.URI;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

@EnabledIfEnvironmentVariable(named = LoxoneDeviceContractTest.GATE, matches = "1")
class LoxoneDeviceContractTest {

    static final String GATE = "COURTSIDE_LOXONE_DEVICE_TEST";

    private static final String PREFIX = "COURTSIDE_ACCESS_CONTROL_LOXONE_";
    private static final Duration DEADLINE = Duration.ofSeconds(15);

    @Test
    void givenTheMaintainersMiniserver_whenTheContractRuns_thenItIsRecordedAndLeavesNoUserOfItsOwn()
            throws NoSuchAlgorithmException {
        // given
        String user = required("USER");
        String password = required("PASSWORD");
        String serial = optional("SERIAL");
        String url = optional("URL");
        if (serial.isEmpty() == url.isEmpty()) {
            throw new AssertionError("set exactly one of " + PREFIX + "SERIAL and " + PREFIX + "URL");
        }
        LoxoneAddress address = serial.isEmpty() ? new LoxoneAddress.Fixed(URI.create(url))
                : LoxoneAddress.Serial.throughLoxoneCloud(serial.toUpperCase(Locale.ROOT));
        String zone = optional("ZONE");
        ZoneId clubZone = ZoneId.of(zone.isEmpty() ? "Europe/Berlin" : zone);
        LoxoneSettings settings = new LoxoneSettings(address, user, password, () -> clubZone, DEADLINE);
        String code = String.valueOf(10_000_000 + new SecureRandom().nextInt(90_000_000));
        List<String> secrets = new ArrayList<>(List.of(user, password, code));
        secrets.add(serial.isEmpty() ? URI.create(url).getHost() : serial);
        LoxoneRecorder recorder = new LoxoneRecorder(secrets);
        DeviceGuard guard = new DeviceGuard(recorder, recorder::created);
        Clock clock = Clock.systemUTC();
        LoxoneClient client = new LoxoneClient(settings, SSLContext.getDefault(), clock,
                LoxoneLogin.clientUuid("courtside-device-contract", address));
        client.tap(guard);

        // when
        LoxoneDeviceContract.Observed observed;
        try (LoxoneAccessControl device = new LoxoneAccessControl(settings, accessPoint -> Optional.empty(), client,
                clock)) {
            observed = new LoxoneDeviceContract(device, client, settings, clock, recorder, guard, code).run();
        }
        recorder.write(RecordedFixtures.RECORDED);

        // then
        observed.checks().forEach(checked -> System.out.println("check " + checked.check() + ": "
                + checked.result().outcome() + " " + checked.result().code() + " " + checked.result().parameters()));
        System.out.println("updateuseraccesscode answered " + observed.code() + ", for a code another user holds "
                + observed.duplicateCode());
        assertThat(observed.leftOver()).as("the run lists none of its own users at its end").isEmpty();
    }

    private static String required(String key) {
        String value = optional(key);
        if (value.isEmpty()) {
            throw new AssertionError("the device run needs " + PREFIX + key);
        }
        return value;
    }

    private static String optional(String key) {
        String value = System.getenv(PREFIX + key);
        return value == null ? "" : value.strip();
    }
}
