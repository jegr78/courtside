package org.courtside.access;

import org.jspecify.annotations.NullMarked;

/** A group on the access-control system that an access point can be mapped onto. */
@NullMarked
public record RemoteGroup(String id, String name) {
}
