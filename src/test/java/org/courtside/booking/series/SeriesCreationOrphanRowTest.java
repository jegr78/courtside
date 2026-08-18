package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.booking.BookingService;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Role;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
@Import(FacilityTestFixture.class)
class SeriesCreationOrphanRowTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    private SeriesService seriesService;

    @Autowired
    private BookingSeriesRepository seriesRepository;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @MockitoBean
    private BookingService bookings;

    private UUID courtOne;

    @BeforeEach
    void setUp() {
        courtOne = facilityFixture.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    void givenBookingCreationFailsWithAnExceptionTheLoopDoesNotHandle_whenCreating_thenNoSeriesRowSurvives() {
        // given
        when(bookings.create(any())).thenThrow(new IllegalStateException("simulated failure"));
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 2);
        List<Instant> confirmed = seriesService.preview(rule, UUID.randomUUID(), null,
                        Set.of(Role.TRAINER)).occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();

        // when / then
        assertThatThrownBy(() -> seriesService.create(rule, confirmed, UUID.randomUUID(), null,
                Set.of(Role.TRAINER), "Training"))
                .isInstanceOf(IllegalStateException.class);
        assertThat(seriesRepository.count()).isZero();
    }
}
