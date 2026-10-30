package org.courtside.access.internal;

import org.jspecify.annotations.Nullable;

record Decision(Action action, @Nullable String code) {

    @Override
    public String toString() {
        return "Decision[action=" + action + "]";
    }
}
