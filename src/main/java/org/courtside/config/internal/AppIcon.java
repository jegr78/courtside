package org.courtside.config.internal;

public final class AppIcon {

    private final byte[] content;
    private final String version;

    AppIcon(byte[] content, String version) {
        this.content = content.clone();
        this.version = version;
    }

    public byte[] content() {
        return content.clone();
    }

    public String version() {
        return version;
    }
}
