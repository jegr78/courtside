package org.courtside.operations.internal;

public enum CheckReason {
    NOT_CONFIGURED,
    NOT_RECORDED,
    UNREADABLE,
    NOT_YET_OBSERVED,
    PENDING_MIGRATIONS,
    FAILED_MIGRATION,
    HANDOVER_FAILING,
    LAST_MESSAGE_FAILED,
    RECORDED_IN_THE_FUTURE
}
