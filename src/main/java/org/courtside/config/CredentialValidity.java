package org.courtside.config;

import org.courtside.shared.CredentialsRequested;

import java.time.Duration;

// An invitation has to survive a holiday and a reset does not, which is why the two differ and why
// a club that knows its own members may say so.
public interface CredentialValidity {

    Duration validFor(CredentialsRequested.Reason reason);
}
