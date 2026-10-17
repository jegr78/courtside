package org.courtside.operations.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminOperatorHealthApi;
import org.courtside.api.ApiOperatorBackupCheck;
import org.courtside.api.ApiOperatorCheckReason;
import org.courtside.api.ApiOperatorCheckState;
import org.courtside.api.ApiOperatorHealth;
import org.courtside.api.ApiOperatorMailCheck;
import org.courtside.api.ApiOperatorMigrationCheck;
import org.courtside.api.ApiOperatorPublicOriginCheck;
import org.courtside.api.ApiOperatorVersionCheck;
import org.courtside.operations.internal.CheckReason;
import org.courtside.operations.internal.CheckState;
import org.courtside.operations.internal.OperatorHealth;
import org.courtside.operations.internal.OperatorHealthService;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class OperatorHealthAdminController implements AdminOperatorHealthApi {

    private final OperatorHealthService health;

    @Override
    public ResponseEntity<ApiOperatorHealth> readOperatorHealth() {
        OperatorHealth read = health.read();
        return ResponseEntity.ok(new ApiOperatorHealth(
                WireTypes.toOffsetDateTime(read.checkedAt()),
                new ApiOperatorVersionCheck(ApiOperatorCheckState.OK, read.version().version(),
                        read.version().revision(), WireTypes.toOffsetDateTime(read.version().builtAt())),
                new ApiOperatorMigrationCheck(state(read.migrations().state()), reason(read.migrations().reason()),
                        read.migrations().currentVersion(), read.migrations().expectedVersion(),
                        read.migrations().pending(), read.migrations().location()),
                new ApiOperatorMailCheck(state(read.mail().state()), reason(read.mail().reason()),
                        WireTypes.toOffsetDateTime(read.mail().lastHandedOverAt()), read.mail().location()),
                new ApiOperatorPublicOriginCheck(state(read.publicOrigin().state()),
                        reason(read.publicOrigin().reason()), read.publicOrigin().origin()),
                new ApiOperatorBackupCheck(state(read.backup().state()), reason(read.backup().reason()),
                        WireTypes.toOffsetDateTime(read.backup().completedAt()), read.backup().ageSeconds(),
                        read.backup().location())));
    }

    private static ApiOperatorCheckState state(CheckState state) {
        return ApiOperatorCheckState.fromValue(state.name());
    }

    private static ApiOperatorCheckReason reason(CheckReason reason) {
        return reason == null ? null : ApiOperatorCheckReason.fromValue(reason.name());
    }
}
