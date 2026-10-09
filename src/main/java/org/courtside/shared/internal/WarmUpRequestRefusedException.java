package org.courtside.shared.internal;

final class WarmUpRequestRefusedException extends IllegalStateException {

    WarmUpRequestRefusedException(String path, int status, String problemType) {
        super("GET " + path + " answered " + status + " with problem type " + problemType);
    }
}
