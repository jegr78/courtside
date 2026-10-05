package org.courtside.securityassessment;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SecuritySessionAttributeProjectionTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static boolean executed;

    private static byte[] serialized(Object value) throws IOException {
        var bytes = new ByteArrayOutputStream();
        try (var stream = new ObjectOutputStream(bytes)) {
            stream.writeObject(value);
        }
        return bytes.toByteArray();
    }

    private static byte[] input(String name, byte[] bytes) {
        return JSON.writeValueAsBytes(Map.of("attributes", List.of(Map.of(
                "name", name, "attributeBytes", "\\x" + HexFormat.of().formatHex(bytes)))));
    }

    @Test
    void givenNativeLong_whenProjected_thenDigestAndTypedValueMatch() throws Exception {
        // given
        var bytes = serialized(123L);
        // when
        var result = JSON.readTree(SecuritySessionAttributeProjection.project(input("courtside.authenticated-at", bytes)));
        // then
        var attribute = result.get("attributes").get(0);
        assertThat(attribute.get("decoder").asString()).isEqualTo("spring-jdbc-java-serialization-v1");
        assertThat(attribute.get("bytesDigest").asString()).isEqualTo("sha256:" + HexFormat.of().formatHex(
                java.security.MessageDigest.getInstance("SHA-256").digest(bytes)));
        assertThat(attribute.get("value").get("className").asString()).isEqualTo("java.lang.Long");
        assertThat(attribute.get("value").get("value").asLong()).isEqualTo(123L);
        assertThat(attribute.size()).isEqualTo(4);
    }

    @Test
    void givenNativeString_whenProjected_thenOnlySemanticValueIsReturned() throws Exception {
        // given
        var request = input("courtside.browser-family", serialized("FIREFOX"));
        // when
        var result = JSON.readTree(SecuritySessionAttributeProjection.project(request));
        // then
        assertThat(result.get("attributes").get(0).get("value").get("value").asString()).isEqualTo("FIREFOX");
        assertThat(result.toString()).doesNotContain("attributeBytes", "password");
    }

    @Test
    void givenMaliciousReadObject_whenProjected_thenRejectedBeforeExecution() throws Exception {
        // given
        executed = false;
        var request = input("courtside.browser-family", serialized(new Gadget()));
        // when / then
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(request)).isInstanceOf(IOException.class)
                .hasMessage("session-attribute-projection-rejected");
        assertThat(executed).isFalse();
    }

    @Test
    void givenForgedNonSerializableDescriptor_whenProjected_thenRejectedBeforeReadObjectExecution() throws Exception {
        // given
        executed = false;
        var original = serialized(new Gadget());
        var gadgetName = Gadget.class.getName().getBytes(StandardCharsets.UTF_8);
        var unknownName = NonSerializable.class.getName().getBytes(StandardCharsets.UTF_8);
        int descriptorStart = 8;
        var forged = new ByteArrayOutputStream();
        forged.write(original, 0, descriptorStart - 2);
        forged.write(unknownName.length >>> 8);
        forged.write(unknownName.length & 255);
        forged.write(unknownName);
        forged.write(original, descriptorStart + gadgetName.length, original.length - descriptorStart - gadgetName.length);
        // when / then
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(input("courtside.browser-family", forged.toByteArray())))
                .isInstanceOf(IOException.class).hasMessage("session-attribute-projection-rejected");
        assertThat(executed).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"attributes\":[]}", "{\"attributes\":[],\"secret\":1}",
            "{\"attributes\":[],\"attributes\":[]}", "{\"attributes\":[]}{}", "null",
            "{\"attributes\":[{\"name\":\"unknown\",\"attributeBytes\":\"\\\\x00\"}]}",
            "{\"attributes\":[{\"name\":\"courtside.browser-family\",\"attributeBytes\":\"\\\\x0Z\"}]}",
            "{\"attributes\":[{\"name\":\"courtside.browser-family\",\"attributeBytes\":\"\\\\x\"}]}"})
    void givenMalformedEnvelope_whenProjected_thenFailsClosed(String request) {
        // given
        var bytes = request.getBytes(StandardCharsets.UTF_8);
        // when / then
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(bytes)).isInstanceOf(IOException.class)
                .hasMessage("session-attribute-projection-rejected");
    }

    @Test
    void givenDuplicateAttributes_whenProjected_thenRejected() throws Exception {
        // given
        var attribute = JSON.readTree(input("courtside.browser-family", serialized("Firefox"))).get("attributes").get(0);
        var request = JSON.writeValueAsBytes(Map.of("attributes", List.of(attribute, attribute)));
        // when / then
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(request)).isInstanceOf(IOException.class);
    }

    @Test
    void givenTrailingObjectOrResetOrByte_whenProjected_thenRejected() throws Exception {
        // given
        var bytes = new ByteArrayOutputStream();
        try (var stream = new ObjectOutputStream(bytes)) {
            stream.writeObject("Firefox");
            stream.writeObject(new Gadget());
        }
        // when / then
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(input("courtside.browser-family", bytes.toByteArray())))
                .isInstanceOf(IOException.class);
        for (byte suffix : new byte[]{0x79, 0x00}) {
            var original = serialized("Firefox");
            var extended = java.util.Arrays.copyOf(original, original.length + 1);
            extended[original.length] = suffix;
            assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(input("courtside.browser-family", extended)))
                    .isInstanceOf(IOException.class);
        }
    }

    @Test
    void givenOversizeOrUnknownArrayOrWrongType_whenProjected_thenRejected() throws Exception {
        // given
        var large = new byte[262145];
        // when / then
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(large)).isInstanceOf(IOException.class);
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(input("courtside.browser-family", serialized(new Object[257]))))
                .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(input("courtside.browser-family", serialized(123L))))
                .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(input("courtside.authenticated-at", serialized(Long.MAX_VALUE))))
                .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(input("courtside.browser-family", serialized("x".repeat(65536)))))
                .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(input("courtside.browser-family", serialized(java.time.Duration.ofSeconds(1)))))
                .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(input("courtside.browser-family", serialized(java.time.LocalDate.of(2026, 1, 1)))))
                .isInstanceOf(IOException.class);
    }

    @Test
    void givenUnclassifiedBrowserText_whenProjected_thenCannotEchoSecret() throws Exception {
        // given
        var request = input("courtside.browser-family", serialized("private-password-marker"));
        // when / then
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(request)).isInstanceOf(IOException.class)
                .hasMessage("session-attribute-projection-rejected");
    }

    @Test
    void givenMaximumHexOrDeepGraphOrManyNodes_whenProjected_thenFailsWithinBounds() throws Exception {
        // given
        var deepest = new java.util.ArrayList<Object>();
        var next = deepest;
        for (int depth = 0; depth < 32; depth++) {
            var nested = new java.util.ArrayList<Object>();
            next.add(nested);
            next = nested;
        }
        var many = new java.util.ArrayList<Object>();
        for (int count = 0; count < 32; count++) {
            var nested = new java.util.ArrayList<Object>();
            for (int item = 0; item < 32; item++) nested.add(Long.valueOf(count * 32L + item));
            many.add(nested);
        }
        // when / then
        for (var bytes : List.of(new byte[65536], new byte[65537], serialized(deepest), serialized(many))) {
            assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(input("courtside.browser-family", bytes)))
                    .isInstanceOf(IOException.class).hasMessage("session-attribute-projection-rejected");
        }
    }

    @Test
    void givenNullOrExtraFieldOrTruncatedStream_whenProjected_thenRejected() throws Exception {
        // given
        var attribute = Map.of("name", "courtside.browser-family", "attributeBytes", "\\xaced0005", "password", "private-marker");
        var request = JSON.writeValueAsBytes(Map.of("attributes", List.of(attribute)));
        var serialized = serialized("FIREFOX");
        // when / then
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(null)).isInstanceOf(IOException.class);
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(request)).isInstanceOf(IOException.class);
        assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(input("courtside.browser-family", serialized(null))))
                .isInstanceOf(IOException.class);
        for (int length = 0; length < serialized.length; length++) {
            var truncated = java.util.Arrays.copyOf(serialized, length);
            assertThatThrownBy(() -> SecuritySessionAttributeProjection.project(input("courtside.browser-family", truncated)))
                    .isInstanceOf(IOException.class);
        }
    }

    @Test
    void givenNativeEntrypoint_whenOversizeInputOrGadgetIsPassed_thenOutputIsEmptyAndErrorIsSanitized() throws Exception {
        // given
        var executable = java.nio.file.Path.of(System.getProperty("java.home"), "bin", "java").toAbsolutePath().toString();
        var requests = List.of(new byte[262145], input("courtside.browser-family", serialized(new Gadget())));
        // when / then
        for (var request : requests) {
            var process = new ProcessBuilder(executable, "--sun-misc-unsafe-memory-access=deny", "-cp",
                    System.getProperty("java.class.path"), SecuritySessionAttributeProjection.class.getName()).start();
            try (var stdin = process.getOutputStream()) {
                stdin.write(request);
            }
            assertThat(process.waitFor(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            assertThat(process.exitValue()).isEqualTo(1);
            assertThat(process.getInputStream().readAllBytes()).isEmpty();
            assertThat(new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8))
                    .isEqualTo("session-attribute-projection-rejected\n");
        }
    }

    @Test
    void givenNativeEntrypoint_whenValidAttributesArePassed_thenOneJsonProjectionIsWritten() throws Exception {
        // given
        var executable = java.nio.file.Path.of(System.getProperty("java.home"), "bin", "java").toAbsolutePath().toString();
        var process = new ProcessBuilder(executable, "--sun-misc-unsafe-memory-access=deny", "-cp",
                System.getProperty("java.class.path"), SecuritySessionAttributeProjection.class.getName()).start();
        // when
        try (var stdin = process.getOutputStream()) {
            stdin.write(input("courtside.browser-family", serialized("FIREFOX")));
        }
        // then
        assertThat(process.waitFor(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        assertThat(process.exitValue()).isZero();
        assertThat(process.getErrorStream().readAllBytes()).isEmpty();
        var result = JSON.readTree(process.getInputStream().readAllBytes());
        assertThat(result.get("attributes").get(0).get("value").get("value").asString()).isEqualTo("FIREFOX");
    }

    private static final class Gadget implements Serializable {
        private void readObject(ObjectInputStream stream) throws IOException, ClassNotFoundException {
            executed = true;
            stream.defaultReadObject();
        }
    }

    private static final class NonSerializable {
        private void readObject(ObjectInputStream stream) throws IOException, ClassNotFoundException {
            executed = true;
            stream.defaultReadObject();
        }
    }
}
