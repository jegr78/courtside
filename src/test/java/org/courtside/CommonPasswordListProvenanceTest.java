package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;

class CommonPasswordListProvenanceTest {

    private static final String LIST = "/security/common-passwords.txt";

    // NOTICE is what a reader checks the shipped list against, and a hash nothing verifies is a
    // claim that goes stale the first time somebody edits, truncates or refreshes the file.
    @Test
    void givenTheShippedList_whenItIsHashed_thenNoticeStatesThatHash()
            throws IOException, NoSuchAlgorithmException {
        // given
        String notice = Files.readString(Path.of("NOTICE"), StandardCharsets.UTF_8);

        // when
        String actual = sha256Of(LIST);

        // then
        assertThat(notice)
                .as("NOTICE must state the SHA-256 of %s, which is %s", LIST, actual)
                .contains(actual);
    }

    private static String sha256Of(String resource) throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream bytes = CommonPasswordListProvenanceTest.class.getResourceAsStream(resource)) {
            assertThat(bytes).as("%s is on the classpath", resource).isNotNull();
            return HexFormat.of().formatHex(digest.digest(bytes.readAllBytes()));
        }
    }
}
