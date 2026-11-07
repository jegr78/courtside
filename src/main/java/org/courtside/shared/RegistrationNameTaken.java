package org.courtside.shared;

import java.util.UUID;

/** A registration asked for a username another account holds; the mail goes to the submitted address. */
public record RegistrationNameTaken(UUID holderAccountId, String submittedAddress, String language) {
}
