package org.courtside.notification.internal;

import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncement.AnnouncedPayment;
import org.courtside.shared.IssuedAccessCodes;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BookingRefundWordingTest {

    private static final UUID BOOKER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID CO_PLAYER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");

    private final BookingWording wording = new BookingWording(mock(ClubIdentity.class),
            new MailTemplates(mock(MessageTemplateOverrides.class)), mock(IssuedAccessCodes.class));

    @Test
    void givenARefundedBooking_whenTheBookerAndACoPlayerAreTold_thenOnlyTheBookerReadsOfTheMoney() {
        // given
        BookingAnnouncement booking = booking(new AnnouncedPayment(1500, "EUR", AnnouncedPayment.PaymentMethod.CREDIT,
                true));

        // when
        String toBooker = wording.refund(booking, account(BOOKER), Locale.ENGLISH);
        String toCoPlayer = wording.refund(booking, account(CO_PLAYER), Locale.ENGLISH);

        // then
        assertThat(toBooker).contains("€15.00 are back on your credit.");
        assertThat(toCoPlayer).as("a co-player paid nothing and reads nothing about money").isEmpty();
    }

    @Test
    void givenAPaidBookingNotRefunded_whenTheBookerIsTold_thenNoRefundIsPromised() {
        // given
        BookingAnnouncement booking = booking(new AnnouncedPayment(1500, "EUR", AnnouncedPayment.PaymentMethod.CREDIT,
                false));

        // when
        String toBooker = wording.refund(booking, account(BOOKER), Locale.ENGLISH);

        // then
        assertThat(toBooker).isEmpty();
    }

    private static BookingAnnouncement booking(AnnouncedPayment payment) {
        return new BookingAnnouncement(BOOKER, List.of(), Instant.parse("2026-05-13T16:00:00Z"),
                Instant.parse("2026-05-13T17:00:00Z"), List.of(new BookingAnnouncement.AnnouncedCourt(1, "Court 1")),
                "Winter doubles", true, null, null, payment);
    }

    private static UserAccount account(UUID id) {
        UserAccount account = mock(UserAccount.class);
        when(account.getId()).thenReturn(id);
        return account;
    }
}
