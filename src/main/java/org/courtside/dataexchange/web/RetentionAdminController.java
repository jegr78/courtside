package org.courtside.dataexchange.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminRetentionApi;
import org.courtside.api.ApiRetentionBlockReason;
import org.courtside.api.ApiRetentionBlockedRecord;
import org.courtside.api.ApiRetentionBookingsPreview;
import org.courtside.api.ApiRetentionCategory;
import org.courtside.api.ApiRetentionFormerMembersPreview;
import org.courtside.api.ApiRetentionPeriod;
import org.courtside.api.ApiRetentionPolicy;
import org.courtside.api.ApiRetentionPreview;
import org.courtside.api.ApiRetentionRun;
import org.courtside.dataexchange.RetentionCategory;
import org.courtside.dataexchange.RetentionPlan;
import org.courtside.dataexchange.RetentionService;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.RecentAuthentication;
import org.courtside.shared.WireTypes;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class RetentionAdminController implements AdminRetentionApi {

    private final RetentionService retention;
    private final CurrentUser currentUser;
    private final RecentAuthentication recentAuthentication;

    @Override
    public ResponseEntity<List<ApiRetentionPolicy>> listRetentionPolicies() {
        return ResponseEntity.ok(retention.policies().stream().map(RetentionAdminController::toResponse).toList());
    }

    @Override
    public ResponseEntity<ApiRetentionPolicy> setRetentionPolicy(ApiRetentionCategory category,
                                                                 ApiRetentionPeriod period) {
        return ResponseEntity.ok(toResponse(retention.setPolicy(toDomain(category), period.getRetainMonths())));
    }

    @Override
    public ResponseEntity<Void> removeRetentionPolicy(ApiRetentionCategory category) {
        retention.removePolicy(toDomain(category));
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<ApiRetentionPreview> previewRetention() {
        RetentionPlan.Preview preview = retention.preview(currentUser.requireAccount().getId());
        RetentionPlan.Bookings bookings = preview.bookings();
        RetentionPlan.FormerMembers formerMembers = preview.formerMembers();
        ApiRetentionPreview response = new ApiRetentionPreview(preview.previewId(),
                WireTypes.toOffsetDateTime(preview.expiresAt()),
                bookings == null ? null : new ApiRetentionBookingsPreview(
                        WireTypes.toOffsetDateTime(bookings.endedBefore()),
                        Math.toIntExact(bookings.bookings()), Math.toIntExact(bookings.series())),
                formerMembers == null ? null : new ApiRetentionFormerMembersPreview(formerMembers.membershipEndedBefore(),
                        Math.toIntExact(formerMembers.people()), Math.toIntExact(formerMembers.accounts())),
                preview.blocked().stream().map(blocked -> new ApiRetentionBlockedRecord(blocked.personId(),
                        ApiRetentionBlockReason.fromValue(blocked.reason().name()))).toList());
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @Override
    public ResponseEntity<ApiRetentionRun> runRetention(UUID id) {
        recentAuthentication.requireRecent();
        RetentionPlan.Run run = retention.run(id, currentUser.requireAccount().getId());
        return ResponseEntity.ok(new ApiRetentionRun(run.runId(), Math.toIntExact(run.bookingsPseudonymised()),
                Math.toIntExact(run.seriesPseudonymised()), Math.toIntExact(run.formerMembersRemoved()),
                Math.toIntExact(run.accountsRemoved()), Math.toIntExact(run.formerMembersSkipped())));
    }

    private static RetentionCategory toDomain(ApiRetentionCategory category) {
        return RetentionCategory.valueOf(category.getValue());
    }

    private static ApiRetentionPolicy toResponse(RetentionPlan.Policy policy) {
        return new ApiRetentionPolicy(ApiRetentionCategory.fromValue(policy.category().name()), policy.retainMonths());
    }
}
