package org.courtside.config;

import java.time.Duration;

// Separate from CredentialValidity because a code that permits a password change and a password
// that grants access are not the same thing and must not share a setting.
public interface PasswordResetTokenValidity {

    Duration resetCodeLifetime();
}
