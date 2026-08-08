package org.courtside.identity;

import java.util.Arrays;
import java.util.Optional;

public enum Role {
    MEMBER,
    TRAINER,
    GROUNDSKEEPER,
    TREASURER,
    ADMIN;

    public static Optional<Role> named(String name) {
        return Arrays.stream(values())
                .filter(role -> role.name().equals(name))
                .findFirst();
    }
}
