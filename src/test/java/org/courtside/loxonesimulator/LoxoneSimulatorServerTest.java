package org.courtside.loxonesimulator;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.BindException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LoxoneSimulatorServerTest {

    private final HttpClient http = HttpClient.newHttpClient();
    private LoxoneSimulatorServer server;

    @BeforeEach
    void start() throws IOException {
        InetSocketAddress loopback = new InetSocketAddress(InetAddress.getLoopbackAddress(), 0);
        server = new LoxoneSimulatorServer(loopback, loopback);
    }

    @AfterEach
    void stop() {
        server.close();
        http.close();
    }

    @Test
    void givenARunningSimulator_whenAFailureIsPut_thenTheDevicePlaysItAndTheControlReadsItBack() throws Exception {
        // when
        HttpResponse<String> selected = send("PUT", "unknown-group");
        HttpResponse<String> read = send("GET", null);

        // then
        assertThat(selected.statusCode()).isEqualTo(200);
        assertThat(server.device().failure()).isEqualTo(Failure.UNKNOWN_GROUP);
        assertThat(read.body().strip()).isEqualTo("unknown-group");
    }

    @Test
    void givenASelectedFailure_whenAnUnknownNameIsPut_thenItIsRefusedNamingTheChoicesAndTheFailureStays()
            throws Exception {
        // given
        send("PUT", "offline");

        // when
        HttpResponse<String> refused = send("PUT", "flooded");

        // then
        assertThat(refused.statusCode()).isEqualTo(400);
        assertThat(refused.body()).as("the refusal lists what can be chosen")
                .contains("none", "wrong-credentials", "missing-right", "locked-user", "disabled-user",
                        "refused-token", "unknown-group", "offline");
        assertThat(server.device().failure()).isEqualTo(Failure.OFFLINE);
    }

    @Test
    void givenTheContainerServer_whenTheDeviceIsAsked_thenItAnswersPlainHttpWithoutKeepingRequests()
            throws Exception {
        // when
        HttpResponse<String> answered = http.send(HttpRequest.newBuilder(server.device().url()
                .resolve("/jdev/cfg/apiKey")).build(), HttpResponse.BodyHandlers.ofString());

        // then
        assertThat(server.device().url().getScheme()).as("Caddy terminates TLS in front of the device")
                .isEqualTo("http");
        assertThat(answered.statusCode()).isEqualTo(200);
        assertThat(answered.body()).contains("\"control\":\"dev/cfg/apiKey\"", "17.0.3.31");
        assertThat(server.device().requests()).as("a long-running simulator keeps no request log").isEmpty();
    }

    @Test
    void givenATakenControlPort_whenTheServerStarts_thenItFailsAndReleasesTheDevicePort() throws Exception {
        // given
        InetAddress loopback = InetAddress.getLoopbackAddress();
        int devicePort;
        try (ServerSocket probe = new ServerSocket(0, 0, loopback)) {
            devicePort = probe.getLocalPort();
        }
        try (ServerSocket taken = new ServerSocket(0, 0, loopback)) {

            // when / then
            assertThatThrownBy(() -> new LoxoneSimulatorServer(new InetSocketAddress(loopback, devicePort),
                    new InetSocketAddress(loopback, taken.getLocalPort()))).isInstanceOf(BindException.class);
        }
        assertThatCode(() -> new ServerSocket(devicePort, 0, loopback).close())
                .as("a failed start leaves no device listener behind").doesNotThrowAnyException();
    }

    private HttpResponse<String> send(String method, String body) throws IOException, InterruptedException {
        HttpRequest.BodyPublisher publisher = body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body);
        return http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.controlPort() + "/failure"))
                .method(method, publisher).build(), HttpResponse.BodyHandlers.ofString());
    }
}
