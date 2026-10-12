package org.courtside.notification.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiCancellationReason;
import org.courtside.api.AccountNotificationsApi;
import org.courtside.api.ApiMessageKind;
import org.courtside.api.ApiNotification;
import org.courtside.api.ApiNotificationBooking;
import org.courtside.api.ApiNotificationClosure;
import org.courtside.api.ApiNotificationCourt;
import org.courtside.api.ApiNotificationLink;
import org.courtside.api.ApiNotificationPage;
import org.courtside.api.ApiNotificationWaitlistOffer;
import org.courtside.notification.internal.OwnNotifications;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.WireTypes;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
class NotificationController implements AccountNotificationsApi {

    private final OwnNotifications notifications;

    @Override
    public ResponseEntity<ApiNotificationPage> listOwnNotifications(UUID cursor, Integer limit) {
        OwnNotifications.Page page = notifications.page(cursor, limit);
        return ResponseEntity.ok(new ApiNotificationPage(page.items().stream()
                .map(NotificationController::toResponse)
                .toList(), page.unread())
                .nextCursor(page.nextCursor()));
    }

    @Override
    public ResponseEntity<Void> markOwnNotificationRead(UUID notificationId) {
        notifications.markRead(notificationId);
        return ResponseEntity.noContent().build();
    }

    private static ApiNotification toResponse(OwnNotifications.Entry entry) {
        ApiNotificationLink link = new ApiNotificationLink(ApiNotificationLink.TargetEnum.fromValue(entry.target().name()))
                .bookingId(entry.linkedBookingId())
                .waitlistEntryId(entry.linkedWaitlistEntryId());
        return new ApiNotification(entry.id(), ApiMessageKind.fromValue(entry.kind().name()),
                WireTypes.toOffsetDateTime(entry.createdAt()), link)
                .readAt(WireTypes.toOffsetDateTime(entry.readAt()))
                .booking(entry.booking() == null ? null : toResponse(entry.booking()))
                .closure(entry.closure() == null ? null : ApiNotificationClosure.fromValue(entry.closure().name()))
                .cancellationReason(entry.cancellationReason() == null ? null
                        : ApiCancellationReason.fromValue(entry.cancellationReason().name()))
                .waitlistOffer(entry.waitlistOffer() == null ? null : new ApiNotificationWaitlistOffer(
                        toResponse(entry.waitlistOffer().slot()),
                        WireTypes.toOffsetDateTime(entry.waitlistOffer().expiresAt()), entry.waitlistOffer().open()));
    }

    private static ApiNotificationBooking toResponse(BookingAnnouncement booking) {
        return new ApiNotificationBooking(WireTypes.toOffsetDateTime(booking.startsAt()),
                WireTypes.toOffsetDateTime(booking.endsAt()),
                booking.courts().stream()
                        .map(court -> new ApiNotificationCourt(court.number()).name(court.name()))
                        .toList(),
                booking.cardLabel(), booking.cancelled());
    }
}
