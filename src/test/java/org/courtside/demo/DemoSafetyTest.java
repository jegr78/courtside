package org.courtside.demo;

import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingService;
import org.courtside.facility.FacilityService;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.password.PasswordEncoder;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.time.Clock;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DemoSafetyTest {

    @Test
    void givenDisposableUseWasNotConfirmed_whenGuardingTheEnvironment_thenStartupIsRejected() {
        // given
        DemoEnvironmentGuard guard = new DemoEnvironmentGuard(
                mock(DataSource.class), mock(Environment.class),
                new DemoProperties(false, "member-password"), "127.0.0.1");

        // when / then
        assertThatThrownBy(() -> guard.run(new DefaultApplicationArguments(new String[0])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_DEMO_CONFIRM_DISPOSABLE");
    }

    @Test
    void givenARemoteDatabase_whenGuardingTheDemoEnvironment_thenStartupIsRejected() throws Exception {
        // given
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        DatabaseMetaData metadata = mock(DatabaseMetaData.class);
        Environment environment = mock(Environment.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getMetaData()).thenReturn(metadata);
        when(metadata.getURL()).thenReturn("jdbc:postgresql://database.example.org:5432/courtside");
        when(environment.getActiveProfiles()).thenReturn(new String[]{"test", "demo"});
        DemoEnvironmentGuard guard = new DemoEnvironmentGuard(
                dataSource, environment, new DemoProperties(true, "member-password"), "127.0.0.1");

        // when / then
        assertThatThrownBy(() -> guard.run(new DefaultApplicationArguments(new String[0])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("local PostgreSQL database named courtside_dev");
    }

    @Test
    void givenANonLoopbackServerAddress_whenGuardingTheDemoEnvironment_thenStartupIsRejected() {
        // given
        DemoEnvironmentGuard guard = new DemoEnvironmentGuard(
                mock(DataSource.class), mock(Environment.class),
                new DemoProperties(true, "member-password"), "0.0.0.0");

        // when / then
        assertThatThrownBy(() -> guard.run(new DefaultApplicationArguments(new String[0])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("loopback server address");
    }

    @Test
    void givenAnUnexpectedSoleAdmin_whenSeedingAnUnmarkedDatabase_thenStartupIsRejected() {
        // given
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        UserAccount unexpected = account("Mary", "Major", "mary.major", Role.ADMIN);
        unexpected.requirePasswordChange();
        when(accounts.existsByUsername("jane.doe")).thenReturn(false);
        when(accounts.findAll()).thenReturn(List.of(unexpected));
        DemoDataSeeder seeder = new DemoDataSeeder(
                mock(PersonRepository.class), accounts, mock(MemberRepository.class),
                mock(FacilityService.class), mock(BookingService.class), mock(BookingRepository.class),
                mock(PasswordEncoder.class), Clock.systemUTC(),
                new DemoProperties(true, "member-password"), "admin", "admin-password",
                () -> java.time.ZoneId.of("Europe/Berlin"));

        // when / then
        assertThatThrownBy(() -> seeder.run(new DefaultApplicationArguments(new String[0])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("only the bootstrap administrator");
    }

    private static UserAccount account(String firstName, String lastName, String username, Role role) {
        return new UserAccount(new Person(firstName, lastName, username + "@example.org"),
                username, "password-hash", Set.of(role));
    }
}
