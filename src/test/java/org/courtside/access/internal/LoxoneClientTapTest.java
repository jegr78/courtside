package org.courtside.access.internal;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;

class LoxoneClientTapTest extends LoxoneTestSupport {

    private record Seen(String command, List<String> arguments, Map<String, String> query) {
    }

    private record Answered(String command, int status, String body) {
    }

    private final List<Seen> requests = new CopyOnWriteArrayList<>();
    private final List<Answered> responses = new CopyOnWriteArrayList<>();

    private final LoxoneClient.Tap tap = new LoxoneClient.Tap() {
        @Override
        public void request(String command, List<String> arguments, Map<String, String> query) {
            requests.add(new Seen(command, List.copyOf(arguments), Map.copyOf(query)));
        }

        @Override
        public void response(String command, int status, byte[] body) {
            responses.add(new Answered(command, status, new String(body, StandardCharsets.UTF_8)));
        }
    };

    @Test
    void givenATap_whenAnAuthenticatedRequestIsSent_thenItSeesEveryRequestAndAnswerWithoutTheToken() {
        // given
        try (LoxoneClient client = new LoxoneClient(simulator.settingsByUrl(DEADLINE), LoxoneSimulator.clientTrust(),
                clock)) {
            client.tap(tap);

            // when
            client.session().sps("getuserlist2");
        }

        // then
        assertThat(requests).extracting(Seen::command).as("the login and the request each reach the tap, in order")
                .startsWith("getkey2", "getjwt", "getuserlist2");
        Seen list = requests.get(2);
        assertThat(list.arguments()).as("getuserlist2 carries no arguments").isEmpty();
        assertThat(list.query()).as("the token and the user never reach the tap").isEmpty();
        assertThat(requests).allSatisfy(seen -> assertThat(seen.arguments())
                .as("no request hands the tap an issued token").doesNotContainAnyElementsOf(simulator.issuedTokens()));
        assertThat(responses).extracting(Answered::command).as("every answer is handed over with its command")
                .startsWith("getkey2", "getjwt", "getuserlist2");
        assertThat(responses.get(2).status()).isEqualTo(200);
        assertThat(responses.get(2).body()).as("the tap receives the body as the Miniserver sent it")
                .startsWith("{\"LL\":").contains("\"control\":\"dev/sps/getuserlist2");
    }

    @Test
    void givenATap_whenTheAddressIsResolvedBySerial_thenGetipIsSeenWithItsSerial() {
        // given
        try (LoxoneClient client = new LoxoneClient(simulator.settingsBySerial(DEADLINE),
                LoxoneSimulator.clientTrust(), clock)) {
            client.tap(tap);

            // when
            client.session().authenticate();
        }

        // then
        assertThat(requests).first().as("the lookup reaches the tap as its own request")
                .isEqualTo(new Seen("getip", List.of(), Map.of("snr", LoxoneSimulator.SERIAL)));
        assertThat(responses).first().as("the lookup's answer reaches the tap").satisfies(answer -> {
            assertThat(answer.command()).isEqualTo("getip");
            assertThat(answer.status()).isEqualTo(200);
            assertThat(answer.body()).contains("\"url\"");
        });
    }
}
