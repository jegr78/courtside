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
                new ApiOperatorVersionCheck(ApiOperatorCheckState.OK, read.version().version())
                        .revision(read.version().revision())
                        .builtAt(WireTypes.toOffsetDateTime(read.version().builtAt())),
                new ApiOperatorMigrationCheck(state(read.migrations().state()), read.migrations().pending())
                        .reason(reason(read.migrations().reason()))
                        .currentVersion(read.migrations().currentVersion())
                        .expectedVersion(read.migrations().expectedVersion())
                        .location(read.migrations().location()),
                new ApiOperatorMailCheck(state(read.mail().state()))
                        .reason(reason(read.mail().reason()))
                        .lastHandedOverAt(WireTypes.toOffsetDateTime(read.mail().lastHandedOverAt()))
                        .location(read.mail().location()),
                new ApiOperatorPublicOriginCheck(state(read.publicOrigin().state()))
                        .reason(reason(read.publicOrigin().reason()))
                        .origin(read.publicOrigin().origin()),
                new ApiOperatorBackupCheck(state(read.backup().state()))
                        .reason(reason(read.backup().reason()))
                        .completedAt(WireTypes.toOffsetDateTime(read.backup().completedAt()))
                        .ageSeconds(read.backup().ageSeconds())
                        .location(read.backup().location())));
    }

    private static ApiOperatorCheckState state(CheckState state) {
        return ApiOperatorCheckState.fromValue(state.name());
    }

    private static ApiOperatorCheckReason reason(CheckReason reason) {
        return reason == null ? null : ApiOperatorCheckReason.fromValue(reason.name());
    }
}
