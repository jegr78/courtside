package org.courtside.dataexchange;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public record SnapshotUpload(String fileName, String declaredMediaType, byte[] content) {

    private static final int MAX_FILE_NAME_LENGTH = 200;
    private static final List<String> EXTENSIONS = List.of(".csv", ".txt");
    static final List<String> MEDIA_TYPES = List.of("text/csv", "text/plain",
            "application/vnd.ms-excel", "application/octet-stream");

    // A file whose first bytes are a container, an image or an executable is not a member list,
    // whatever its name and its declared type say.
    private static final Map<String, byte[]> SIGNATURES = Map.of(
            "zip", new byte[] {0x50, 0x4b, 0x03, 0x04},
            "pdf", new byte[] {0x25, 0x50, 0x44, 0x46},
            "png", new byte[] {(byte) 0x89, 0x50, 0x4e, 0x47},
            "jpeg", new byte[] {(byte) 0xff, (byte) 0xd8, (byte) 0xff},
            "gif", new byte[] {0x47, 0x49, 0x46, 0x38},
            "workbook", new byte[] {(byte) 0xd0, (byte) 0xcf, 0x11, (byte) 0xe0},
            "executable", new byte[] {0x4d, 0x5a});

    public SnapshotUpload {
        fileName = usableName(fileName);
        requireReadableExtension(fileName);
        requireUsableMediaType(declaredMediaType);
        content = content == null ? null : content.clone();
        requireTextContent(content);
    }

    @Override
    public byte[] content() {
        return content.clone();
    }

    private static String usableName(String fileName) {
        String stripped = fileName == null ? "" : fileName.strip();
        if (stripped.isEmpty() || stripped.length() > MAX_FILE_NAME_LENGTH) {
            throw new SnapshotFileNameInvalidException("import.snapshot.fileNameUnusable",
                    Map.of("maxLength", MAX_FILE_NAME_LENGTH));
        }
        return stripped;
    }

    private static void requireReadableExtension(String fileName) {
        String lower = fileName.toLowerCase(Locale.ROOT);
        if (EXTENSIONS.stream().noneMatch(lower::endsWith)) {
            throw new SnapshotUploadUnsupportedException("import.snapshot.extensionUnsupported",
                    Map.of("extensions", EXTENSIONS));
        }
    }

    // The parameters after a semicolon are the sender's, not a claim about the format.
    private static void requireUsableMediaType(String declared) {
        if (declared == null || declared.isBlank()) {
            return;
        }
        String type = declared.split(";", 2)[0].strip().toLowerCase(Locale.ROOT);
        if (!MEDIA_TYPES.contains(type)) {
            throw new SnapshotUploadUnsupportedException("import.snapshot.mediaTypeUnsupported",
                    Map.of("mediaTypes", MEDIA_TYPES));
        }
    }

    private static void requireTextContent(byte[] content) {
        if (content == null || content.length == 0) {
            throw new SnapshotUploadUnsupportedException("import.snapshot.empty", Map.of());
        }
        boolean carriesASignature = SIGNATURES.values().stream()
                .anyMatch(signature -> content.length >= signature.length
                        && Arrays.equals(signature, Arrays.copyOf(content, signature.length)));
        if (carriesASignature) {
            throw new SnapshotUploadUnsupportedException("import.snapshot.notText", Map.of());
        }
    }
}
