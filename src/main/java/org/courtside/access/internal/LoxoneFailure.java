package org.courtside.access.internal;

/** An unclear answer from the Miniserver; its message is fixed text and never carries a reply body or a URL. */
class LoxoneFailure extends RuntimeException {

    LoxoneFailure(String message) {
        super(ConnectorText.sanitized(message, null), null, false, false);
    }
}
