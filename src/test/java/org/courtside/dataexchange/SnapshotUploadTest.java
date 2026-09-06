package org.courtside.dataexchange;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SnapshotUploadTest {

    private static final byte[] ROSTER = "Nr;Vorname\n1;Jane\n".getBytes(StandardCharsets.ISO_8859_1);

    @Test
    void givenAClubsExport_whenTheBrowserDeclaresAnyTypeItSendsForCsv_thenEveryOneOfThemIsRead() {
        // given — the same file arrives as a different type depending on the system that sends it
        var declared = new String[] {"text/csv", "text/plain", "application/vnd.ms-excel",
                "application/octet-stream", "text/csv; charset=ISO-8859-1", null, "  "};

        // when / then
        for (String type : declared) {
            assertThat(new SnapshotUpload("members.csv", type, ROSTER).fileName())
                    .as("declared as %s", type)
                    .isEqualTo("members.csv");
        }
    }

    @Test
    void givenAnExtensionThePolicyDoesNotAllow_whenUploading_thenItSaysWhichOnesItReads() {
        // when / then
        assertThatThrownBy(() -> new SnapshotUpload("members.xlsx", "text/csv", ROSTER))
                .isInstanceOf(SnapshotUploadUnsupportedException.class)
                .extracting("code").isEqualTo("import.snapshot.extensionUnsupported");
    }

    @Test
    void givenATypeThatContradictsTheFile_whenUploading_thenItIsRefusedBeforeAnythingReadsIt() {
        // when / then
        assertThatThrownBy(() -> new SnapshotUpload("members.csv", "image/png", ROSTER))
                .isInstanceOf(SnapshotUploadUnsupportedException.class)
                .extracting("code").isEqualTo("import.snapshot.mediaTypeUnsupported");
    }

    @Test
    void givenAnImageNamedAndDeclaredAsCsv_whenUploading_thenTheContentDecidesAndRefusesIt() {
        // given — the polyglot: every name agrees, the bytes do not
        byte[] png = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13};

        // when / then
        assertThatThrownBy(() -> new SnapshotUpload("members.csv", "text/csv", png))
                .isInstanceOf(SnapshotUploadUnsupportedException.class)
                .extracting("code").isEqualTo("import.snapshot.notText");
    }

    @Test
    void givenAWorkbookOrArchiveNamedAsCsv_whenUploading_thenItsSignatureIsEnoughToRefuseIt() {
        // given
        byte[] zip = {0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 8, 0};
        byte[] pdf = "%PDF-1.4\n1 0 obj\n".getBytes(StandardCharsets.US_ASCII);

        // when / then
        assertThatThrownBy(() -> new SnapshotUpload("members.csv", "text/csv", zip))
                .isInstanceOf(SnapshotUploadUnsupportedException.class);
        assertThatThrownBy(() -> new SnapshotUpload("members.csv", "text/csv", pdf))
                .isInstanceOf(SnapshotUploadUnsupportedException.class);
    }

    @Test
    void givenAFileWithNothingInIt_whenUploading_thenItSaysThatRatherThanBlamingTheHeader() {
        // when / then
        assertThatThrownBy(() -> new SnapshotUpload("members.csv", "text/csv", new byte[0]))
                .isInstanceOf(SnapshotUploadUnsupportedException.class)
                .extracting("code").isEqualTo("import.snapshot.empty");
    }

    @Test
    void givenAnUnusableName_whenUploading_thenTheExistingFileNameRefusalStillGoverns() {
        // when / then
        assertThatThrownBy(() -> new SnapshotUpload("  ", "text/csv", ROSTER))
                .isInstanceOf(SnapshotFileNameInvalidException.class);
        assertThatThrownBy(() -> new SnapshotUpload("m".repeat(201) + ".csv", "text/csv", ROSTER))
                .isInstanceOf(SnapshotFileNameInvalidException.class);
    }
}
