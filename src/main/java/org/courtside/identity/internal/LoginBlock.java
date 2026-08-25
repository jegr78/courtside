package org.courtside.identity.internal;

import java.time.Duration;

record LoginBlock(String scope, Duration retryAfter) {
}
