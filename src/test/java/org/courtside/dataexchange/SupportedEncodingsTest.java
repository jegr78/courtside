package org.courtside.dataexchange;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SupportedEncodingsTest {

    @Test
    void whenListingWhatTheInstanceCanRead_thenItIsThePlatformsSetRatherThanThisProductsList() {
        // when
        var names = SupportedEncodings.names();

        // then — a club whose export tool writes one of these must not wait for a release for it
        assertThat(names).contains("UTF-8", "windows-1252", "ISO-8859-15", "windows-1250",
                "ISO-8859-2", "KOI8-R", "Shift_JIS");
        assertThat(names).isSorted();
    }

    @Test
    void givenNoEncoding_whenResolvingIt_thenTheDefaultIsUtf8() {
        // when / then
        assertThat(SupportedEncodings.resolve(null)).isEqualTo(StandardCharsets.UTF_8);
        assertThat(SupportedEncodings.resolve("  ")).isEqualTo(StandardCharsets.UTF_8);
    }

    @Test
    void givenAnAliasTheClubTyped_whenResolvingIt_thenItAnswersTheCanonicalCharset() {
        // when / then
        assertThat(SupportedEncodings.resolve("cp1252").name()).isEqualTo("windows-1252");
        assertThat(SupportedEncodings.resolve(" latin1 ").name()).isEqualTo("ISO-8859-1");
    }

    @Test
    void givenANameNoPlatformKnows_whenResolvingIt_thenItSaysSoWithACodeRatherThanAStackTrace() {
        // when / then
        assertThatThrownBy(() -> SupportedEncodings.resolve("not-a-charset"))
                .isInstanceOf(SnapshotEncodingUnsupportedException.class)
                .hasFieldOrPropertyWithValue("code", "import.snapshot.encodingUnsupported");
    }

    @Test
    void givenANameThatIsNotEvenWellFormed_whenResolvingIt_thenItIsTheSameAnswer() {
        // when / then — an illegal name and an unknown one are the same mistake to a club
        assertThatThrownBy(() -> SupportedEncodings.resolve("!! nonsense !!"))
                .isInstanceOf(SnapshotEncodingUnsupportedException.class);
    }
}
