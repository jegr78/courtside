package org.courtside.operations.internal;

public enum OperationalLogSource {
    APPLICATION("courtside-application"),
    DATABASE("courtside-database"),
    PROXY("courtside-proxy");

    private final String syslogTag;

    OperationalLogSource(String syslogTag) {
        this.syslogTag = syslogTag;
    }

    static OperationalLogSource fromSyslogTag(String tag) {
        for (OperationalLogSource source : values()) {
            if (source.syslogTag.equals(tag)) {
                return source;
            }
        }
        return null;
    }
}
