package org.courtside.shared;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

final class DatabaseSecretFile {

    private DatabaseSecretFile() {
    }

    static String read(String property, String configuredPath) {
        if (configuredPath == null || configuredPath.isBlank()) {
            throw new DatabaseIdentityConfigurationException(property + " names no file.",
                    "Mount a read-only secret file and point " + property + " at it.");
        }
        Path path = Path.of(configuredPath);
        if (!Files.isReadable(path) || !Files.isRegularFile(path)) {
            throw new DatabaseIdentityConfigurationException(property + " names " + path
                    + ", which does not exist or cannot be read.",
                    "Restore the intended read-only secret file before starting this service.");
        }
        try {
            String content = Files.readString(path);
            String value = removeTerminalLineEnding(content);
            if (value.isEmpty()) {
                throw new DatabaseIdentityConfigurationException(property + " names " + path
                        + ", which is empty.",
                        "Replace it with the credential configured on the corresponding database role.");
            }
            if (value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
                throw new DatabaseIdentityConfigurationException(property + " names " + path
                        + ", which contains more than one line.",
                        "Store exactly one credential in the file, with an optional final line ending.");
            }
            return value;
        } catch (IOException failure) {
            throw new DatabaseIdentityConfigurationException(property + " names " + path
                    + ", which could not be read.",
                    "Restore the intended read-only secret file before starting this service.", failure);
        }
    }

    private static String removeTerminalLineEnding(String content) {
        if (content.endsWith("\r\n")) {
            return content.substring(0, content.length() - 2);
        }
        if (content.endsWith("\n")) {
            return content.substring(0, content.length() - 1);
        }
        return content;
    }
}
