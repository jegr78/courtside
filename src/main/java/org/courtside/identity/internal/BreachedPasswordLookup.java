package org.courtside.identity.internal;

public interface BreachedPasswordLookup {

    boolean isBreached(String password);
}
