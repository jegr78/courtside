package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.AccountSecurityMaintenance;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
class ControlledRecoveryMaintenance implements AccountSecurityMaintenance {
    private final ControlledAccountRecovery recovery;
    private final MfaSecrets secrets;

    @Override
    public void execute(Command command) {
        switch (command.action()) {
            case "mfa-recover" -> recovery.initiateFromMaintenance(command.account(), command.identityChecked());
            case "mfa-correct-email" -> recovery.correctEmailFromMaintenance(command.account(), MaintenanceEmail.read(command.emailFile()), command.identityChecked());
            case "mfa-rotate-keys" -> secrets.rotate();
            default -> throw new IllegalStateException("Unknown account-security maintenance action");
        }
    }
}
