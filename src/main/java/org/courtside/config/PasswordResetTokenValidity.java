package org.courtside.config;

import java.time.Duration;

public interface PasswordResetTokenValidity {

    Duration resetCodeLifetime();
}
