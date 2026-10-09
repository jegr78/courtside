package org.courtside.booking.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(FacilityTestFixture.class)
class WarmUpTargetTest extends AbstractIntegrationTest {

    private static final int DAYS_AHEAD = 7;

    @Autowired
    private WarmUpTarget targets;

    @Autowired
    private BookingWriteWarmUp bookingWrite;

    @Autowired
    private SeriesPreviewWarmUp seriesPreview;

    @Autowired
    private BookingService bookings;

    @Autowired
    private CardService cards;

    @Autowired
    private FacilityTestFixture facility;

    @BeforeEach
    void openAClub() {
        facility.createCourt(1, "Centre Court");
        Arrays.stream(DayOfWeek.values()).forEach(day ->
                facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
    }

    @Test
    void givenTheFirstOpeningSlotIsTaken_whenATargetIsFound_thenItIsTheSameSlotOnTheNextDay() {
        // given
        WarmUpTarget.Target first = targets.find(DAYS_AHEAD).orElseThrow();
        bookings.create(new CreateBookingCommand(List.of(first.courtId()), first.cardId(), first.slot(),
                UUID.randomUUID(), null, Set.of(Role.ADMIN), null, List.of(), null));

        // when
        WarmUpTarget.Target next = targets.find(DAYS_AHEAD).orElseThrow();

        // then
        assertThat(next.date())
                .as("a slot somebody holds must not be chosen, the next free day's must")
                .isEqualTo(first.date().plusDays(1));
        assertThat(next.startTime())
                .as("the slot must still start at opening time")
                .isEqualTo(first.startTime());
    }

    @Test
    void givenNoActiveCardThatTracksNoPlayers_whenTheBookingStepsRun_thenTheyHaveNothingToExercise() {
        // given
        cards.activeCards().stream()
                .filter(card -> !card.tracksPlayers())
                .map(BookingCard::getId)
                .forEach(card -> cards.setCardActive(card, false));

        // when
        boolean wrote = bookingWrite.run();
        boolean previewed = seriesPreview.run();

        // then
        assertThat(wrote)
                .as("without a card that needs no players there is no booking to write, which is a skip")
                .isFalse();
        assertThat(previewed)
                .as("without a card that needs no players there is no series to preview, which is a skip")
                .isFalse();
    }
}
