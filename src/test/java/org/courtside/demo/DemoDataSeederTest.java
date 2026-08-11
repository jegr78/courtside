package org.courtside;

import org.courtside.booking.BookingRepository;
import org.courtside.facility.CourtRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(classes = CourtsideApplication.class,
        properties = {
                "courtside.demo.confirm-disposable=true",
                "courtside.test.clock=2026-05-12T20:00:00Z"
        })
@ActiveProfiles({"test", "demo"})
@Import({TestcontainersConfiguration.class, FixedClockConfiguration.class})
class DemoDataSeederTest {

    @Autowired
    @Qualifier("demoDataSeeder")
    private ApplicationRunner seeder;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private MemberRepository members;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenAFreshDemoDatabase_whenSeedingTwice_thenAdminAndFixturesExistOnlyOnce() throws Exception {
        // given
        long accountCount = accounts.count();
        long memberCount = members.count();
        long courtCount = courts.count();
        long bookingCount = bookings.count();

        // when
        seeder.run(new DefaultApplicationArguments(new String[0]));

        // then
        assertThat(accounts.count()).isEqualTo(accountCount).isEqualTo(3);
        assertThat(members.count()).isEqualTo(memberCount).isEqualTo(2);
        assertThat(courts.count()).isEqualTo(courtCount).isEqualTo(2);
        assertThat(bookings.count()).isEqualTo(bookingCount).isEqualTo(2);
        assertThat(jdbc.sql("SELECT count(*) FROM flyway_schema_history").query(Long.class).single())
                .isEqualTo(14);
        assertThat(jdbc.sql("SELECT date(starts_at AT TIME ZONE 'Europe/Berlin') "
                + "FROM court_allocation ORDER BY starts_at").query(LocalDate.class).list())
                .containsExactly(LocalDate.of(2026, 5, 12), LocalDate.of(2026, 5, 18));
        assertThat(accounts.findByUsername("admin")).get()
                .satisfies(account -> {
                    assertThat(account.getRoles()).contains(Role.ADMIN);
                    assertThat(account.isPasswordChangeRequired()).isFalse();
                });
        assertThat(accounts.findByUsername("jane.doe")).get()
                .satisfies(account -> assertThat(account.getRoles()).containsExactly(Role.MEMBER));
    }
}
