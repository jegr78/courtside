package org.courtside.securityassessment;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Properties;

final class SecurityAssessmentDataset {

    private static final String RESOURCE = "security-assessment-dataset.properties";
    private static final byte[] CONTENT = readContent();
    private static final Properties PROPERTIES = readProperties();

    private SecurityAssessmentDataset() {
    }

    static String fingerprint() {
        try {
            return "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(CONTENT));
        } catch (NoSuchAlgorithmException failure) {
            throw new IllegalStateException("SHA-256 is unavailable", failure);
        }
    }

    static int isolatedAccountsPerRole() {
        return integer("isolated-accounts-per-role");
    }

    static int managerCombinationAccounts() {
        return integer("manager-combination-accounts");
    }

    static int standaloneBookings() {
        return integer("standalone-bookings");
    }

    static int seriesOccurrences() {
        return integer("series-occurrences");
    }

    private static int integer(String name) {
        String value = PROPERTIES.getProperty(name);
        if (value == null) {
            throw new IllegalStateException("The security assessment dataset property " + name + " is missing");
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException failure) {
            throw new IllegalStateException(
                    "The security assessment dataset property " + name + " is not an integer", failure);
        }
    }

    private static byte[] readContent() {
        try (InputStream input = SecurityAssessmentDataset.class.getClassLoader().getResourceAsStream(RESOURCE)) {
            if (input == null) {
                throw new IllegalStateException("The security assessment dataset specification is missing");
            }
            return input.readAllBytes();
        } catch (IOException failure) {
            throw new IllegalStateException("The security assessment dataset specification cannot be read", failure);
        }
    }

    private static Properties readProperties() {
        Properties properties = new Properties();
        try {
            properties.load(new ByteArrayInputStream(CONTENT));
            return properties;
        } catch (IOException failure) {
            throw new IllegalStateException("The security assessment dataset specification cannot be parsed", failure);
        }
    }
}
