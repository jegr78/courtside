package org.courtside.shared;

class TlsConfigurationException extends RuntimeException {

    private final String action;

    TlsConfigurationException(String message, String action) {
        super(message);
        this.action = action;
    }

    TlsConfigurationException(String message, String action, Throwable cause) {
        super(message, cause);
        this.action = action;
    }

    String action() {
        return action;
    }
}
