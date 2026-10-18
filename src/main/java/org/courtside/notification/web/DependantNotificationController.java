package org.courtside.notification.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiNotificationPage;
import org.courtside.api.DependantNotificationsApi;
import org.courtside.notification.internal.OwnNotifications;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
class DependantNotificationController implements DependantNotificationsApi {

    private final OwnNotifications notifications;

    @Override
    public ResponseEntity<ApiNotificationPage> listDependantNotifications(UUID personId, UUID cursor, Integer limit) {
        OwnNotifications.Page page = notifications.dependantPage(personId, cursor, limit);
        return ResponseEntity.ok(new ApiNotificationPage(page.items().stream()
                .map(NotificationController::toResponse)
                .toList(), page.unread())
                .nextCursor(page.nextCursor()));
    }
}
