package org.courtside.operations.internal;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class OperationalLogParserTest {

    private final OperationalLogParser parser = new OperationalLogParser(
            Clock.fixed(Instant.parse("2026-09-19T15:00:00Z"), ZoneOffset.UTC));

    @Test
    void givenAnApplicationEcsRecord_whenParsing_thenItsTraceAndSeverityArePreserved() {
        String payload = "<14>1 2026-09-19T14:00:00.123Z host courtside-application 1 - - "
                + "{\"@timestamp\":\"2026-09-19T14:00:00.120Z\",\"log\":{\"level\":\"ERROR\"},"
                + "\"message\":\"Role update failed\",\"traceId\":\"0123456789abcdef0123456789abcdef\"}";

        OperationalLogRecord record = parse(payload);

        assertThat(record.source()).isEqualTo(OperationalLogSource.APPLICATION);
        assertThat(record.severity()).isEqualTo(OperationalLogSeverity.ERROR);
        assertThat(record.message()).isEqualTo("Role update failed");
        assertThat(record.traceId()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(record.occurredAt()).hasToString("2026-09-19T15:00:00Z");
    }

    @Test
    void givenPlainDatabaseOutput_whenParsing_thenTheClosedSourceTagIsUsed() {
        OperationalLogRecord record = parse(
                "<11>1 2026-09-19T14:01:00Z host courtside-database 42 - - database unavailable");

        assertThat(record.source()).isEqualTo(OperationalLogSource.DATABASE);
        assertThat(record.severity()).isEqualTo(OperationalLogSeverity.ERROR);
        assertThat(record.message()).isEqualTo("database unavailable");
        assertThat(record.traceId()).isNull();
    }

    @Test
    void givenSensitiveValues_whenParsing_thenTheyAreRedactedBeforeTheRecordExists() {
        OperationalLogRecord record = parse("<14>1 2026-09-19T14:02:00Z host courtside-proxy 1 - - "
                + "Authorization: Bearer secret-token password=hunter2 user=member@example.org "
                + "url=https://club.example/admin/roster?person=42 opaque=abcdefghijklmnopqrstuvwxyz012345 "
                + "person=11111111-2222-3333-4444-555555555555 client=2001:db8:85a3::8a2e:370:7334");

        assertThat(record.message())
                .doesNotContain("secret-token", "hunter2", "member@example.org", "/admin/roster", "abcdefghijklmnopqrstuvwxyz",
                        "11111111-2222-3333-4444-555555555555", "2001:db8:85a3::8a2e:370:7334")
                .contains("[REDACTED]", "https://club.example/<redacted>");
    }

    @Test
    void givenARequestBodyWithDirectIdentifiers_whenParsing_thenItsValuesAreRedacted() {
        OperationalLogRecord record = parse("<14>1 2026-09-19T14:02:00Z host courtside-application 1 - - "
                + "requestBody={\"firstName\":\"Jane\",\"lastName\":\"Doe\","
                + "\"phone\":\"+49 30 123456\",\"memberNumber\":\"ABC-42\"} "
                + "iban=DE89370400440532013000 session=YWNjZXB0YW5jZS1zZWNyZXQ=");

        assertThat(record.message())
                .doesNotContain("Jane", "Doe", "+49 30 123456", "ABC-42", "DE89370400440532013000",
                        "YWNjZXB0YW5jZS1zZWNyZXQ=")
                .contains("[REDACTED]");
    }

    @Test
    void givenDatabaseConstraintDetailWithAName_whenParsing_thenTheValueIsRedacted() {
        OperationalLogRecord record = parse("<11>1 2026-09-19T14:02:00Z host courtside-database 1 - - "
                + "DETAIL: Key (first_name)=(Jane) already exists");

        assertThat(record.message())
                .doesNotContain("Jane")
                .contains("first_name", "[REDACTED]");
    }

    @Test
    void givenUrlUserInfoAndAMultilineBody_whenParsing_thenNeitherSecretCanReachTheRecord() {
        OperationalLogRecord record = parse("<14>1 2026-09-19T14:02:00Z host courtside-proxy 1 - - "
                + "target=https://alice:pw@db.example/private requestBody=pin 1234\nmedical=asthma");

        assertThat(record.message())
                .doesNotContain("alice", "pw", "pin 1234", "medical", "asthma")
                .contains("https://db.example/<redacted>", "requestBody=[REDACTED]");
    }

    @Test
    void givenAnUnknownSourceOrMalformedEnvelope_whenParsing_thenItFailsClosed() {
        assertThat(parser.parse(bytes("not syslog"), bytes("not syslog").length)).isEmpty();
        String foreign = "<14>1 2026-09-19T14:03:00Z host another-container 1 - - raw secret";
        assertThat(parser.parse(bytes(foreign), bytes(foreign).length)).isEmpty();
    }

    @Test
    void givenANonW3cTraceValue_whenParsing_thenItIsNotExposedAsAFilterableIdentifier() {
        OperationalLogRecord record = parse("<14>1 2026-09-19T14:03:00Z host courtside-application 1 - - "
                + "{\"log\":{\"level\":\"ERROR\"},\"message\":\"request failed\","
                + "\"traceId\":\"secret-token-value-that-is-not-a-trace\"}");

        assertThat(record.traceId()).isNull();
    }

    @Test
    void givenAnOversizedDatagram_whenParsing_thenItFailsClosed() {
        byte[] oversized = bytes("<14>1 2026-09-19T14:04:00Z host courtside-application 1 - - " + "x".repeat(16_385));

        assertThat(parser.parse(oversized, oversized.length)).isEmpty();
    }

    @Test
    void givenInvalidEnvelopeBoundsAndFields_whenParsing_thenTheyFailClosed() {
        byte[] valid = bytes("<14>1 2026-09-19T14:04:00Z host courtside-proxy 1 - - ok");
        byte[] structuredData = bytes("<14>1 2026-09-19T14:04:00Z host courtside-proxy 1 - value ok");

        assertThat(parser.parse(valid, 0)).isEmpty();
        assertThat(parser.parse(valid, valid.length + 1)).isEmpty();
        assertThat(parser.parse(structuredData, structuredData.length)).isEmpty();
        assertThat(parseOptional("<192>1 2026-09-19T14:04:00Z host courtside-proxy 1 - - ok")).isEmpty();
        assertThat(parseOptional("<14>1 yesterday host courtside-proxy 1 - - ok")).isEmpty();
    }

    @Test
    void givenInvalidApplicationJsonOrMessage_whenParsing_thenItFailsClosed() {
        assertThat(parseOptional("<14>1 2026-09-19T14:04:00Z host courtside-application 1 - - {")).isEmpty();
        assertThat(parseOptional("<14>1 2026-09-19T14:04:00Z host courtside-application 1 - - {}"))
                .isEmpty();
        assertThat(parseOptional("<14>1 2026-09-19T14:04:00Z host courtside-application 1 - - "
                + "{\"message\":42}"))
                .isEmpty();
        assertThat(parseOptional("<14>1 2026-09-19T14:04:00Z host courtside-proxy 1 - - "
                + "x".repeat(8_193)))
                .isEmpty();
    }

    @Test
    void givenTheNestedTraceShape_whenParsing_thenItsSafeTraceIsPreserved() {
        OperationalLogRecord record = parse("<14>1 2026-09-19T14:04:00Z host courtside-application 1 - - "
                + "{\"log\":{\"level\":\"INFO\"},\"message\":\"ready\","
                + "\"trace\":{\"id\":\"ABCDEF0123456789ABCDEF0123456789\"}}");

        assertThat(record.traceId()).isEqualTo("abcdef0123456789abcdef0123456789");
    }

    @Test
    void severityMappingsCoverEveryAcceptedLevelAndTheirFallbacks() {
        assertThat(OperationalLogSeverity.fromSyslogPriority(4)).isEqualTo(OperationalLogSeverity.WARN);
        assertThat(OperationalLogSeverity.fromSyslogPriority(7)).isEqualTo(OperationalLogSeverity.DEBUG);
        assertThat(OperationalLogSeverity.fromText(null, OperationalLogSeverity.UNKNOWN))
                .isEqualTo(OperationalLogSeverity.UNKNOWN);
        assertThat(OperationalLogSeverity.fromText("fatal", OperationalLogSeverity.UNKNOWN))
                .isEqualTo(OperationalLogSeverity.ERROR);
        assertThat(OperationalLogSeverity.fromText("warning", OperationalLogSeverity.UNKNOWN))
                .isEqualTo(OperationalLogSeverity.WARN);
        assertThat(OperationalLogSeverity.fromText("notice", OperationalLogSeverity.UNKNOWN))
                .isEqualTo(OperationalLogSeverity.INFO);
        assertThat(OperationalLogSeverity.fromText("trace", OperationalLogSeverity.UNKNOWN))
                .isEqualTo(OperationalLogSeverity.DEBUG);
        assertThat(OperationalLogSeverity.fromText("custom", OperationalLogSeverity.UNKNOWN))
                .isEqualTo(OperationalLogSeverity.UNKNOWN);
    }

    private OperationalLogRecord parse(String payload) {
        byte[] bytes = bytes(payload);
        return parser.parse(bytes, bytes.length).orElseThrow();
    }

    private java.util.Optional<OperationalLogRecord> parseOptional(String payload) {
        byte[] bytes = bytes(payload);
        return parser.parse(bytes, bytes.length);
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }
}
