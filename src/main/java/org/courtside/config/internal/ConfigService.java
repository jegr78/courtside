package org.courtside.config.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.BookingGridSettings;
import org.courtside.config.BookingGridConstraint;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.BookingGridCoordination;
import org.courtside.config.ClubTimeZone;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.time.ZoneId;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ConfigService implements BookingGridSettings, BookingGridCoordination, ClubTimeZone {

    private final ClubConfigurationRepository configurations;
    private final List<BookingGridConstraint> bookingGridConstraints;

    public ClubConfigurationSnapshot current() {
        return ClubConfigurationSnapshot.from(currentEntity());
    }

    private ClubConfiguration currentEntity() {
        return configurations.findById(ClubConfiguration.SINGLETON_ID)
                .orElseThrow(() -> new IllegalStateException(
                        "The club configuration row is missing"));
    }

    @Override
    public BookingSlotDuration slotDuration() {
        return new BookingSlotDuration(current().slotMinutes());
    }

    @Override
    public ZoneId zoneId() {
        return ZoneId.of(current().timeZone());
    }

    @Override
    public void lock() {
        configurations.lockById(ClubConfiguration.SINGLETON_ID)
                .orElseThrow(() -> new IllegalStateException(
                        "The club configuration row is missing"));
    }

    @Transactional
    public ClubConfigurationSnapshot update(String clubName, String primaryColor, String accentColor,
                                            String logoUrl, String imprintUrl, String defaultLocale,
                                            int slotMinutes, String timeZone) {
        BookingSlotDuration slotDuration = new BookingSlotDuration(slotMinutes);
        ZoneId zoneId = ZoneId.of(timeZone);
        lock();
        ClubConfiguration configuration = currentEntity();
        if (configuration.getSlotMinutes() != slotMinutes) {
            ZoneId currentZone = ZoneId.of(configuration.getTimeZone());
            bookingGridConstraints.stream()
                    .map(constraint -> constraint.conflictCode(slotDuration, currentZone))
                    .flatMap(java.util.Optional::stream)
                    .findFirst()
                    .ifPresent(code -> {
                        throw new SlotDurationConflictException(code, slotMinutes);
                    });
        }
        if (!configuration.getTimeZone().equals(timeZone)) {
            bookingGridConstraints.stream()
                    .map(constraint -> constraint.timeZoneConflictCode())
                    .flatMap(java.util.Optional::stream)
                    .findFirst()
                    .ifPresent(code -> {
                        throw new TimeZoneConflictException(code, timeZone);
                    });
        }
        configuration.changeTo(clubName, primaryColor, accentColor,
                logoUrl, imprintUrl, defaultLocale, slotMinutes, timeZone);
        return ClubConfigurationSnapshot.from(configuration);
    }
}
