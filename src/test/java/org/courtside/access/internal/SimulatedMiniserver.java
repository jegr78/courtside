package org.courtside.access.internal;

import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import org.courtside.TestCertificate;
import org.courtside.loxonesimulator.LoxoneSimulator;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.ssl.SslBundle;
import org.springframework.boot.ssl.pem.PemSslStoreBundle;
import org.springframework.boot.ssl.pem.PemSslStoreDetails;

import javax.net.ssl.SSLContext;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.time.Clock;
import java.time.Duration;
import java.util.List;

final class SimulatedMiniserver {

    private static @Nullable Credentials credentials;

    private record Credentials(SSLContext server, SSLContext client) {
    }

    private SimulatedMiniserver() {
    }

    static LoxoneSimulator started(Clock clock) throws IOException {
        SSLContext server = credentials().server();
        return new LoxoneSimulator(clock, listener -> {
            HttpsServer opened = HttpsServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
            opened.setHttpsConfigurator(new HttpsConfigurator(server));
            return opened;
        });
    }

    static SSLContext clientTrust() {
        try {
            return credentials().client();
        } catch (IOException unavailable) {
            throw new IllegalStateException("the simulator certificate could not be issued", unavailable);
        }
    }

    static LoxoneSettings settingsByUrl(LoxoneSimulator simulator, Duration deadline) {
        return new LoxoneSettings(new LoxoneAddress.Fixed(simulator.url()), LoxoneSimulator.USER,
                LoxoneSimulator.PASSWORD, deadline);
    }

    static LoxoneSettings settingsBySerial(LoxoneSimulator simulator, Duration deadline) {
        return settingsBySerial(simulator, deadline, List.of(new LoxoneAddress.Relay("localhost", 1, 65_535)));
    }

    static LoxoneSettings settingsBySerial(LoxoneSimulator simulator, Duration deadline,
                                           List<LoxoneAddress.Relay> relays) {
        return new LoxoneSettings(new LoxoneAddress.Serial(LoxoneSimulator.SERIAL, simulator.resolver(), relays),
                LoxoneSimulator.USER, LoxoneSimulator.PASSWORD, deadline);
    }

    private static synchronized Credentials credentials() throws IOException {
        if (credentials == null) {
            try {
                TestCertificate issued = TestCertificate.issuedFor("localhost");
                SSLContext server = SslBundle.of(new PemSslStoreBundle(
                        PemSslStoreDetails.forCertificate(issued.certificate()).withPrivateKey(issued.key()),
                        null)).createSslContext();
                SSLContext client = SslBundle.of(new PemSslStoreBundle(null,
                        PemSslStoreDetails.forCertificate(issued.authority()))).createSslContext();
                credentials = new Credentials(server, client);
            } catch (Exception failed) {
                throw new IOException("the simulator certificate could not be issued", failed);
            }
        }
        return credentials;
    }
}
