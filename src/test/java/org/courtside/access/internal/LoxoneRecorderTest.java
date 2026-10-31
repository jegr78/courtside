package org.courtside.access.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

class LoxoneRecorderTest {

    private static final String SERIAL = "504F94A00000";
    private static final String USER = "courtside-service";
    private static final String PASSWORD = "example-service-password";
    private static final String CREATED = "courtside_probe_0001";
    private static final String LOXONE_UUID = "0f1e2d3c-4b5a-6978-8796a5b4c3d2e1f0";
    private static final String CREATED_UUID = "1a2b3c4d-5e6f-7081-92a3b4c5d6e7f809";
    private static final String CLIENT_UUID = "3b2a1908-7f6e-4d5c-9b8a-0123456789ab";
    private static final String TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJleGFtcGxlIn0.c2lnbmF0dXJl";
    private static final ObjectMapper JSON = new ObjectMapper();

    @TempDir
    Path target;

    private final LoxoneRecorder recorder = new LoxoneRecorder(List.of(SERIAL, USER, PASSWORD));

    @Test
    void givenAUserListWithForeignUsers_whenRecorded_thenOnlyTheUserTheRunCreatedRemains() throws IOException {
        // given
        recorder.created(CREATED);
        recorder.step("user-list");
        exchange("getuserlist2", List.of(), Map.of(), 200, """
                {"LL":{"control":"jdev/sps/getuserlist2","value":"[\
                {\\"name\\":\\"jane.doe\\",\\"uuid\\":\\"%s\\",\\"isAdmin\\":false,\\"userState\\":0},\
                {\\"name\\":\\"admin\\",\\"uuid\\":\\"%s\\",\\"isAdmin\\":true,\\"userState\\":0},\
                {\\"name\\":\\"%s\\",\\"uuid\\":\\"%s\\",\\"isAdmin\\":false,\\"userState\\":4}]","Code":"200"}}
                """.formatted(LOXONE_UUID, CLIENT_UUID, CREATED, CREATED_UUID));

        // when
        recorder.write(target);

        // then
        JsonNode value = JSON.readTree(recorded("user-list").at("/0/response/LL/value").asString());
        assertThat(value.toString()).as("foreign and admin users are dropped, the run's own user is kept scrubbed")
                .isEqualTo("[{\"name\":\"<name-1>\",\"uuid\":\"<loxone-uuid-1>\",\"isAdmin\":false,\"userState\":4}]");
        assertThat(Files.readString(target.resolve("user-list.json"))).as("no foreign user leaves a trace")
                .doesNotContain("jane.doe", "admin", LOXONE_UUID, CLIENT_UUID);
    }

    @Test
    void givenEveryKindOfDeviceValue_whenRecorded_thenEachBecomesAFormatKeepingPlaceholder() throws IOException {
        // given
        recorder.step("formats");
        exchange("getjwt", List.of("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4", USER, "2052", CLIENT_UUID, "Courtside"),
                Map.of(), 200, """
                {"LL":{"control":"dev/sys/getjwt","value":{"token":"%s","key":"%s",\
                "salt":"A1B2C3D4E5F60718","hashAlg":"SHA256","validUntil":547210800,"tokenRights":2052,\
                "unsecurePass":false},"Code":"200"}}
                """.formatted(TOKEN, "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b"));
        exchange("getip", List.of(), Map.of("snr", SERIAL), 200, """
                {"url":"https://192-0-2-10.504f94a00000.dyndns.example.org:7443"}
                """);
        exchange("getuser", List.of(LOXONE_UUID), Map.of(), 200, """
                {"LL":{"control":"jdev/sps/getuser/%s","value":{"uuid":"%s","usergroups":["%s"],\
                "lastEdit":"2026-11-02 10:00:00","validFrom":547210000,"userState":4,\
                "keycodes":[{"code":"4826"}]},"Code":"200"}}
                """.formatted(LOXONE_UUID, LOXONE_UUID, CLIENT_UUID));
        exchange("apiKey", List.of(), Map.of(), 200, """
                {"LL":{"control":"dev/cfg/apiKey","value":{"version":"14.2.5.16","snr":"50:4F:94:A0:00:01",\
                "url":["192.0.2.10","192-0-2-10","miniserver.example.org",31]},"Code":"200"}}
                """);

        // when
        recorder.write(target);

        // then
        JsonNode formats = recorded("formats");
        JsonNode jwt = formats.at("/0/response/LL/value");
        assertThat(jwt.get("token").asString()).as("a token").matches("<token-[0-9]+>");
        assertThat(jwt.get("key").asString()).as("a key keeps its length").matches("<hex40-[0-9]+>");
        assertThat(jwt.get("salt").asString()).as("a salt keeps its length and case").matches("<hex16-upper-[0-9]+>");
        assertThat(jwt.get("hashAlg").asString()).as("an enum is kept").isEqualTo("SHA256");
        assertThat(jwt.get("validUntil").asString()).as("a time in seconds").matches("<time-[0-9]+>");
        assertThat(jwt.get("tokenRights").asInt()).as("a number that is not a time is kept").isEqualTo(2052);
        assertThat(formats.at("/0/request/arguments").toString()).as("the login's arguments")
                .matches("\\[\"<hex40-[0-9]+>\",\"<secret-[0-9]+>\",\"<digits4-[0-9]+>\",\"<uuid-[0-9]+>\","
                        + "\"Courtside\"]");
        assertThat(formats.at("/1/request/query/snr").asString()).as("the serial").matches("<secret-[0-9]+>");
        assertThat(formats.at("/1/response/url").asString()).as("an address keeps its scheme and port")
                .matches("https://<host-[0-9]+>:<port-[0-9]+>");
        JsonNode user = formats.at("/2/response/LL/value");
        assertThat(user.get("uuid").asString()).as("a Loxone uuid").matches("<loxone-uuid-[0-9]+>");
        assertThat(user.at("/usergroups/0").asString()).as("the same value gets the same placeholder in every step")
                .isEqualTo(formats.at("/0/request/arguments/3").asString());
        assertThat(formats.at("/2/request/arguments/0").asString()).as("the same uuid in request and answer")
                .isEqualTo(user.get("uuid").asString());
        assertThat(formats.at("/2/response/LL/control").asString()).as("the echoed request line")
                .isEqualTo("jdev/sps/getuser/" + user.get("uuid").asString());
        assertThat(user.get("lastEdit").asString()).as("a time as text").matches("<time-[0-9]+>");
        assertThat(user.get("validFrom").asString()).as("a time in Loxone seconds").matches("<time-[0-9]+>");
        assertThat(user.get("userState").asInt()).as("an allowlisted number is kept").isEqualTo(4);
        assertThat(user.at("/keycodes/0/code").asString()).as("a keycode").matches("<digits4-[0-9]+>");
        JsonNode api = formats.at("/3/response/LL/value");
        assertThat(api.get("version").asString()).as("a version is kept").isEqualTo("14.2.5.16");
        assertThat(api.get("snr").asString()).as("a MAC").matches("<mac-[0-9]+>");
        assertThat(api.at("/url/0").asString()).as("an address").matches("<ip-[0-9]+>");
        assertThat(api.at("/url/1").asString()).as("an address with dashes").matches("<dashed-ip-[0-9]+>");
        assertThat(api.at("/url/2").asString()).as("a host").matches("<host-[0-9]+>");
        assertThat(api.at("/url/3").asString()).as("a number under a key outside the numeric allowlist")
                .matches("<number-[0-9]+>");
    }

    static Stream<Arguments> secretSpellings() {
        return Stream.of(
                Arguments.of("{\"LL\":{\"value\":{\"error\":\"Door at 504f94a00000\"}}}", List.of(),
                        "$[0].response.LL.value.error", "504f94a00000"),
                Arguments.of("{\"LL\":{\"value\":{\"name\":\"Miniserver 50:4f:94:a0:00:00 online\"}}}", List.of(),
                        "$[0].response.LL.value.name", "50:4f:94:a0:00:00"),
                Arguments.of("{\"LL\":{\"value\":{\"name\":\"Miniserver 50-4F-94-A0-00-00 online\"}}}", List.of(),
                        "$[0].response.LL.value.name", "50-4f-94-a0-00-00"),
                Arguments.of("{\"LL\":{\"Code\":\"200\"}}", List.of("Pass=EXAMPLE-SERVICE-PASSWORD"),
                        "$[0].request.arguments[0]", "example-service-password"));
    }

    @ParameterizedTest
    @MethodSource("secretSpellings")
    void givenAConfiguredSecretInAnotherSpelling_whenRecorded_thenTheRunFailsNamingWhereButNotTheValue(
            String body, List<String> arguments, String path, String secret) {
        // given
        recorder.step("leak");
        exchange("getuser", arguments, Map.of(), 200, body);

        // when
        AssertionError refused = catchThrowableOfType(AssertionError.class, () -> recorder.write(target));

        // then
        assertThat(refused).as("a surviving secret refuses the recording").isNotNull();
        assertThat(refused.getMessage()).as("the refusal names the step and the key path")
                .contains("leak " + path).contains("configured secret");
        assertThat(refused.getMessage().toLowerCase(Locale.ROOT)).as("the refusal never repeats the secret")
                .doesNotContain(secret);
    }

    @Test
    void givenAnApiKeyValueAsASingleQuotedString_whenRecorded_thenItIsScrubbedAsAnObjectAndKeepsItsForm()
            throws IOException {
        // given
        recorder.step("api-key");
        exchange("apiKey", List.of(), Map.of(), 200, """
                {"LL":{"control":"dev/cfg/apiKey","value":"{'snr': '50:4F:94:A0:00:00', 'version':'14.2.5.16', \
                'key':'9f86d081884c7d659a2feaa0c55ad015a3bf4f1b', 'isInTrust':0, 'local':false, 'httpsStatus':1}",\
                "Code":"200"}}
                """);

        // when
        recorder.write(target);

        // then
        JsonNode value = recorded("api-key").at("/0/response/LL/value");
        assertThat(value.isString()).as("the value stays a string, as the Miniserver sent it").isTrue();
        assertThat(value.asString()).as("in the single-quoted form it arrived in")
                .matches("\\{'snr':'<secret-[0-9]+>','version':'14\\.2\\.5\\.16','key':'<hex40-[0-9]+>',"
                        + "'isInTrust':'<number-[0-9]+>','local':false,'httpsStatus':1}");
        assertThat(Files.readString(target.resolve("api-key.json")).toLowerCase(Locale.ROOT))
                .as("the serial inside the string is gone").doesNotContain("50:4f:94:a0:00:00");
        assertThat(RecordedFixtures.violations(target)).as("the written form passes the fixture check").isEmpty();
    }

    @Test
    void givenAnUnknownFieldNameHoldingAString_whenRecorded_thenTheRunFailsNamingTheFieldButNotItsValue() {
        // given
        recorder.step("unknown-field");
        exchange("apiKey", List.of(), Map.of(), 200, """
                {"LL":{"control":"dev/cfg/apiKey","value":"{'version':'14.2.5.16', 'cloudLabel':'Clubhouse North'}",\
                "Code":"200"}}
                """);

        // when / then
        assertThatThrownBy(() -> recorder.write(target)).isInstanceOf(AssertionError.class)
                .hasMessageContaining("unknown-field $[0].response.LL.value(json).cloudLabel holds a string")
                .hasMessageNotContaining("Clubhouse");
    }

    @Test
    void givenKeysShapedLikeAUuidOrAPersonsName_whenTheRunFails_thenTheMessageKeepsThemHidden() {
        // given
        recorder.step("hidden-keys");
        exchange("getuser", List.of(), Map.of(), 200, """
                {"LL":{"control":"jdev/sps/getuser","value":{"%s":"Clubhouse North","jane.doe":"Court side"},\
                "Code":"200"}}
                """.formatted(LOXONE_UUID));

        // when
        AssertionError refused = catchThrowableOfType(AssertionError.class, () -> recorder.write(target));

        // then
        assertThat(refused).as("unknown strings refuse the recording").isNotNull();
        assertThat(refused.getMessage()).as("a key outside the name shape stays a placeholder")
                .contains("LL.value.<key-").doesNotContain(LOXONE_UUID).doesNotContain("jane.doe")
                .doesNotContain("Clubhouse");
    }

    @Test
    void givenAControlEchoingTheLoginWithAUserInsideAProtocolWord_whenRecorded_thenEverySegmentAfterTheCommandIsScrubbed()
            throws IOException {
        // given
        LoxoneRecorder shortUser = new LoxoneRecorder(List.of(SERIAL, "courtside", PASSWORD));
        shortUser.step("login");
        shortUser.request("getjwt", List.of("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4", "courtside", "2084",
                CLIENT_UUID, "Courtside"), Map.of());
        shortUser.response("getjwt", 200, """
                {"LL":{"control":"dev/sys/getjwt/a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4/courtside/2084/%s/Courtside",\
                "value":{"tokenRights":2084},"Code":"200"}}
                """.formatted(CLIENT_UUID).strip().getBytes(StandardCharsets.UTF_8));
        shortUser.request("getuser", List.of(), Map.of());
        shortUser.response("getuser", 500, """
                {"LL":{"control":"jdev/sps/getuser/Example","value":"","Code":"500"}}
                """.strip().getBytes(StandardCharsets.UTF_8));

        // when
        shortUser.write(target);

        // then
        assertThat(recorded("login").at("/0/response/LL/control").asString())
                .as("the command stays, every later segment is a placeholder")
                .matches("dev/sys/getjwt(/<[a-z0-9-]+-[0-9]+>){5}");
        assertThat(recorded("login").at("/1/response/LL/control").asString())
                .as("a word no pattern knows becomes a placeholder too").matches("jdev/sps/getuser/<segment-[0-9]+>");
    }

    @Test
    void givenAUserWithFreeTextFields_whenRecorded_thenEachBecomesAPlaceholderAndAnEmptyOneStaysEmpty()
            throws IOException {
        // given
        recorder.created(CREATED);
        recorder.step("user-fields");
        exchange("getuser", List.of(), Map.of(), 200, """
                {"LL":{"control":"jdev/sps/getuser","value":{"name":"%s","firstName":"Jane","lastName":"Doe",\
                "email":"jane.doe@example.org","phone":"","company":"Example Tennis Club","desc":"Front desk",\
                "customFields":["Custom Field 1","Custom Field 2","Custom Field 3","Custom Field 4","Custom Field 5"],\
                "customField1":"Locker 12","masterAdmin":false,"scorePWD":2},"Code":"200"}}
                """.formatted(CREATED));

        // when
        recorder.write(target);

        // then
        JsonNode user = recorded("user-fields").at("/0/response/LL/value");
        for (String field : List.of("firstName", "lastName", "email", "company", "desc", "customField1")) {
            assertThat(user.get(field).asString()).as(field).matches("<[a-z0-9-]+-[0-9]+>");
        }
        assertThat(user.get("phone").asString()).as("an empty field stays empty").isEmpty();
        assertThat(user.get("customFields").valueStream().map(JsonNode::asString))
                .allSatisfy(label -> assertThat(label).matches("<text-[0-9]+>"));
        assertThat(Files.readString(target.resolve("user-fields.json")))
                .doesNotContain("Jane", "Doe", "example.org", "Custom Field", "Locker", "Front desk");
    }

    @Test
    void givenAnApiKeyWhoseKeyIsNotHex_whenRecorded_thenTheKeyIsStillAPlaceholder() throws IOException {
        // given
        recorder.step("api-key-text");
        exchange("apiKey", List.of(), Map.of(), 200, """
                {"LL":{"control":"dev/cfg/apiKey","value":"{'version':'14.2.5.16', 'key':'Ab-Cd'}","Code":"200"}}
                """);

        // when
        recorder.write(target);

        // then
        assertThat(recorded("api-key-text").at("/0/response/LL/value").asString())
                .matches("\\{'version':'14\\.2\\.5\\.16','key':'<text-[0-9]+>'}");
    }

    @Test
    void givenANumericCodeOutsideTheEnvelope_whenRecorded_thenOnlyTheEnvelopeCodeStaysANumber() throws IOException {
        // given
        recorder.step("numeric-code");
        exchange("getuser", List.of(), Map.of(), 200, """
                {"LL":{"control":"jdev/sps/getuser","value":{"keycodes":[{"code":4826}]},"Code":200}}
                """);

        // when
        recorder.write(target);

        // then
        JsonNode envelope = recorded("numeric-code").at("/0/response/LL");
        assertThat(envelope.at("/value/keycodes/0/code").asString()).as("a door code stored as a number")
                .matches("<number-[0-9]+>");
        assertThat(envelope.get("Code").asInt()).as("the envelope's status stays a number").isEqualTo(200);
    }

    @Test
    void givenAUserSentAsJson_whenRecorded_thenItsProtocolNumbersStayAndItsTimesBecomePlaceholders()
            throws IOException {
        // given
        recorder.created(CREATED);
        recorder.step("create");
        exchange("addoredituser", List.of("{\"name\":\"" + CREATED + "\",\"userState\":4,\"validFrom\":547210000,"
                + "\"expirationAction\":1}"), Map.of(), 200, "{\"LL\":{\"Code\":\"200\"}}");

        // when
        recorder.write(target);

        // then
        JsonNode sent = JSON.readTree(recorded("create").at("/0/request/arguments/0").asString());
        assertThat(sent.toString()).as("the user's state and expiration action stay, its name and time do not")
                .matches("\\{\"name\":\"<name-[0-9]+>\",\"userState\":4,\"validFrom\":\"<time-[0-9]+>\","
                        + "\"expirationAction\":1}");
    }

    @Test
    void givenKeysOutsideTheProtocol_whenRecorded_thenEachBecomesAPlaceholder() throws IOException {
        // given
        recorder.step("keys");
        exchange("getuser", List.of(), Map.of(), 200, """
                {"LL":{"control":"jdev/sps/getuser","value":{"doorName":"%s","COURTSIDE-SERVICE":7},"Code":"200"}}
                """.formatted(CLIENT_UUID));

        // when
        recorder.write(target);

        // then
        JsonNode value = recorded("keys").at("/0/response/LL/value");
        assertThat(value.propertyNames()).as("every key outside the protocol becomes a placeholder")
                .allSatisfy(key -> assertThat(key).matches("<(key|secret)-[0-9]+>"));
        assertThat(value.valueStream().map(JsonNode::asString)).as("their values are scrubbed as well")
                .allSatisfy(scrubbed -> assertThat(scrubbed).matches("<(uuid|number)-[0-9]+>"));
        assertThat(Files.readString(target.resolve("keys.json")).toLowerCase(Locale.ROOT))
                .as("no raw key survives").doesNotContain("doorname", USER);
    }

    @Test
    void givenAnUnknownStringUnderAProtocolKey_whenRecorded_thenTheRunFailsNamingWhereButNotTheValue() {
        // given
        recorder.step("unknown");
        exchange("getuser", List.of(), Map.of(), 200,
                "{\"LL\":{\"control\":\"jdev/sps/getuser\",\"value\":{\"name\":\"Game, set, match\"},"
                        + "\"Code\":\"200\"}}");

        // when / then
        assertThatThrownBy(() -> recorder.write(target)).isInstanceOf(AssertionError.class)
                .hasMessageContaining("unknown $[0].response.LL.value.name holds a string that is neither")
                .hasMessageNotContaining("Game");
    }

    @Test
    void givenRequestLinesWithATokenAndAUser_whenRecorded_thenOnlyTheCommandAndPlaceholdersRemain()
            throws IOException {
        // given
        String echoed = "/jdev/sps/deleteuser/" + LOXONE_UUID + "?autht=" + TOKEN + "&user=" + USER;
        recorder.step("delete");
        exchange("getkey2", List.of(USER), Map.of(), 200,
                "{\"LL\":{\"control\":\"dev/sys/getkey2/" + USER + "\",\"value\":{\"hashAlg\":\"SHA1\"},"
                        + "\"Code\":\"200\"}}");
        exchange("deleteuser", List.of(LOXONE_UUID), Map.of(), 200,
                "{\"LL\":{\"control\":\"" + echoed + "\",\"value\":\"" + echoed + "\",\"Code\":\"200\"}}");
        exchange("getuserlist2", List.of(), Map.of(), 401, "<html>401 " + echoed + "</html>");

        // when
        recorder.write(target);

        // then
        JsonNode delete = recorded("delete");
        String uuid = delete.at("/1/request/arguments/0").asString();
        assertThat(uuid).as("the argument becomes a placeholder").matches("<loxone-uuid-[0-9]+>");
        assertThat(delete.at("/0/request/arguments/0").asString()).as("the user argument").matches("<secret-[0-9]+>");
        assertThat(delete.at("/0/response/LL/control").asString()).as("the echoed login line")
                .matches("dev/sys/getkey2/<secret-[0-9]+>");
        assertThat(delete.at("/1/response/LL/control").asString()).as("the echoed line keeps only the command")
                .isEqualTo("/jdev/sps/deleteuser/" + uuid);
        assertThat(delete.at("/1/response/LL/value").asString()).as("so does a value that repeats it")
                .isEqualTo("/jdev/sps/deleteuser/" + uuid);
        assertThat(delete.at("/2/response").asString()).as("a markup body").matches("<html-[0-9]+>");
        assertThat(Files.readString(target.resolve("delete.json"))).as("no token, user or query survives")
                .doesNotContain("autht", "user=", TOKEN, USER);
    }

    @Test
    void givenAFailingRun_whenRecorded_thenTheRecordedDirectoryIsUnchanged() throws IOException {
        // given
        Path recordedDirectory = target.resolve("recorded");
        LoxoneRecorder earlier = new LoxoneRecorder(List.of(SERIAL, USER, PASSWORD));
        earlier.step("earlier");
        earlier.request("getuserlist2", List.of(), Map.of());
        earlier.response("getuserlist2", 200, "{\"LL\":{\"Code\":\"200\"}}".getBytes(StandardCharsets.UTF_8));
        earlier.write(recordedDirectory);
        String before = Files.readString(recordedDirectory.resolve("earlier.json"));
        Path absent = target.resolve("absent");
        recorder.step("failing");
        exchange("getuser", List.of(), Map.of(), 200, "{\"LL\":{\"value\":{\"motto\":\"Game, set, match\"}}}");

        // when
        assertThatThrownBy(() -> recorder.write(recordedDirectory)).isInstanceOf(AssertionError.class);
        assertThatThrownBy(() -> recorder.write(absent)).isInstanceOf(AssertionError.class);

        // then
        try (Stream<Path> files = Files.list(recordedDirectory)) {
            assertThat(files.map(file -> file.getFileName().toString())).as("a failing run adds no file")
                    .containsExactly("earlier.json");
        }
        assertThat(Files.readString(recordedDirectory.resolve("earlier.json"))).as("nor changes one")
                .isEqualTo(before);
        assertThat(absent).as("a failing run creates no recorded directory").doesNotExist();
    }

    private void exchange(String command, List<String> arguments, Map<String, String> query, int status,
                          String body) {
        recorder.request(command, arguments, query);
        recorder.response(command, status, body.strip().getBytes(StandardCharsets.UTF_8));
    }

    private JsonNode recorded(String step) throws IOException {
        return JSON.readTree(Files.readString(target.resolve(step + ".json")));
    }
}
