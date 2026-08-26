package org.courtside.shared.web;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MalformedRequestTargetTest extends AbstractIntegrationTest {

    @LocalServerPort
    private int port;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void whenARequestTargetIsMalformed_thenTheConnectorsRefusalIsAProblemToo() throws Exception {
        // given — the connector rejects these before any dispatch the application could answer
        for (String target : List.of("/api/a|b", "/api/a^b", "/api/%zz", "/api/a[b]")) {
            // when
            Response response = send("GET " + target);

            // then
            assertThat(response.statusLine).as(target).startsWith("HTTP/1.1 400");
            assertThat(response.contentType).as(target).startsWith("application/problem+json");
            JsonNode problem = objectMapper.readTree(response.body);
            assertThat(problem.at("/type").asString()).as(target)
                    .isEqualTo("urn:courtside:error:request-rejected");
            assertThat(problem.at("/title").asString()).as(target).isEqualTo("Request rejected");
            assertThat(problem.at("/status").asInt()).as(target).isEqualTo(400);
        }
    }

    @Test
    void whenARequestIsWellFormed_thenTheConnectorsErrorReportStaysOutOfItsAnswer() throws Exception {
        // when
        Response served = send("GET /api/public/config");
        Response unmapped = send("GET /api/public/does-not-exist");

        // then
        assertThat(served.statusLine).startsWith("HTTP/1.1 200");
        assertThat(served.contentType).startsWith("application/json");
        assertThat(unmapped.statusLine).startsWith("HTTP/1.1 404");
        assertThat(objectMapper.readTree(unmapped.body).at("/type").asString())
                .isEqualTo("urn:courtside:error:unmapped-path");
    }

    private Response send(String requestLine) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            OutputStream out = socket.getOutputStream();
            // HTTP/1.0, so the answer arrives unchunked and this reader stays a reader.
            out.write((requestLine + " HTTP/1.0\r\nHost: localhost\r\n\r\n")
                    .getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            String statusLine = reader.readLine();
            String contentType = "";
            List<String> body = new ArrayList<>();
            boolean inBody = false;
            String line;
            while ((line = reader.readLine()) != null) {
                if (inBody) {
                    body.add(line);
                } else if (line.isEmpty()) {
                    inBody = true;
                } else if (line.toLowerCase().startsWith("content-type:")) {
                    contentType = line.substring("content-type:".length()).trim();
                }
            }
            return new Response(statusLine, contentType, String.join("", body));
        }
    }

    private record Response(String statusLine, String contentType, String body) {
    }
}
