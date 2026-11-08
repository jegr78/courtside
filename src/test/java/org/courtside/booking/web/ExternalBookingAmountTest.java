package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.credit.testfixture.CreditTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, BookingTestFixture.class, CardTestFixture.class,
        ConfigTestFixture.class, CreditTestFixture.class})
class ExternalBookingAmountTest extends AbstractIntegrationTest {

    private static final TimeSlot EVENING =
            new TimeSlot(Instant.parse("2026-05-13T17:00:00Z"), Instant.parse("2026-05-13T18:30:00Z"));

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private UserDetailsService userDetails;
    @Autowired
    private FacilityTestFixture facility;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private BookingTestFixture bookings;
    @Autowired
    private CardTestFixture cards;
    @Autowired
    private ConfigTestFixture config;
    @Autowired
    private CreditTestFixture credit;

    @Test
    void givenAPricedBookingOfAnExternalPlayer_whenTheyReadTheirBookings_thenTheStampedAmountComesWithIt()
            throws Exception {
        // given
        MockMvc mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        UUID court = facility.createCourt(1, "Court 1");
        config.admitExternalBookings(true);
        UUID winterDoubles = cards.createDoublesCardForGuestsAllowing("Winter doubles", Set.of(Role.EXTERNAL));
        cards.priceForExternals(winterDoubles, 1600);
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");
        UUID johnAccount = identity.createEnabledAccount(john, "roe.john", Set.of(Role.EXTERNAL));
        credit.credit(johnAccount, 2400);
        bookings.createBookingWithGuest(court, winterDoubles, EVENING, johnAccount, john, Set.of(Role.EXTERNAL),
                null, "Mary Major");
        cards.priceForExternals(winterDoubles, 2000);

        // when / then
        mockMvc.perform(get("/api/my/bookings").with(SecurityMockMvcRequestPostProcessors.user(
                        userDetails.loadUserByUsername("roe.john"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].amount.minor").value(2400))
                .andExpect(jsonPath("$.items[0].amount.currency").value("EUR"));
    }
}
