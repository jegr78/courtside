package org.courtside.access;

import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

import java.util.UUID;

/** Courtside's own name for a grant, and the reference the system answered with its last installation. */
@NullMarked
public record GrantReference(UUID grantId, @Nullable String externalReference) {

    public GrantReference {
        if (grantId == null) {
            throw new IllegalArgumentException("A grant reference names its grant");
        }
    }
}
