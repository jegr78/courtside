package org.courtside.notification.internal;

import jakarta.mail.Multipart;
import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.verify;

@ExtendWith(OutputCaptureExtension.class)
@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class})
class MembersDoorCodeMessageTest extends AbstractIntegrationTest {

    private static final String OLD_CODE = "135790";
    private static final String NEW_CODE = "975310";
    private static final LocalDate TODAY = LocalDate.of(2026, 5, 12);

    @MockitoSpyBean
    private JavaMailSender sender;

    @MockitoBean(name = "mailOutboxExecutor")
    private TaskExecutor executor;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private MailOutbox outbox;

    private UUID membershipType;
    private UUID clubhouseDoor;
    private UUID janeAccount;

    @BeforeEach
    void aClubhouseDoorOpenToMembersAndJaneAsItsOnlyCurrentMember() {
        doNothing().when(sender).send(any(MimeMessage.class));
        membershipType = members.createMembershipType("Adult");
        clubhouseDoor = facility.createAccessPoint("Clubhouse door", List.of(), OLD_CODE, true);
        janeAccount = member("Jane", "Doe", TODAY.minusMonths(4), null);
        member("John", "Roe", TODAY.minusYears(1), TODAY.minusDays(1));
        jdbc.sql("DELETE FROM message_record").update();
        jdbc.sql("DELETE FROM notification").update();
    }

    @Test
    void givenAClubhouseDoorOpenToMembers_whenItsCodeChanges_thenEveryCurrentMemberIsToldTheNewCodeOnce(
            CapturedOutput output) throws Exception {
        // when
        facility.changeAccessPoint(clubhouseDoor, "Clubhouse door", List.of(), NEW_CODE, true);
        outbox.deliverDue();

        // then
        assertThat(toldAccounts()).as("one message to the current member and none to the former one")
                .containsExactly(janeAccount);
        assertThat(bodyTo("jane.doe@example.org")).contains("Clubhouse door: " + NEW_CODE).doesNotContain(OLD_CODE);
        assertThat(String.join("|", jdbc.sql("SELECT payload::text FROM domain_event").query(String.class).list()))
                .as("the code never enters the audit log").doesNotContain(OLD_CODE).doesNotContain(NEW_CODE);
        assertThat(output.getAll()).as("the code never enters the log").doesNotContain(NEW_CODE);
    }

    @Test
    void givenADoorWithACode_whenItIsOpenedToMembers_thenEveryCurrentMemberIsTold() {
        // given
        UUID backDoor = facility.createAccessPoint("Back door", List.of(), NEW_CODE, false);

        // when
        facility.changeAccessPoint(backDoor, "Back door", List.of(), NEW_CODE, true);

        // then
        assertThat(toldAccounts()).as("a door newly open to members hands its code to them").containsExactly(janeAccount);
    }

    @Test
    void givenAClubhouseDoorOpenToMembers_whenOnlyItsNameAndCourtsChange_thenNoMemberIsTold() {
        // given
        UUID court = facility.createCourt(1, "Court 1");

        // when
        facility.changeAccessPoint(clubhouseDoor, "Clubhouse entrance", List.of(court), OLD_CODE, true);

        // then
        assertThat(toldAccounts()).as("a code the members already hold is not sent again").isEmpty();
    }

    @Test
    void givenJaneAsACurrentMember_whenADoorIsCreatedOpenToMembers_thenOnlyJaneIsTold() {
        // when
        facility.createAccessPoint("Back door", List.of(), NEW_CODE, true);

        // then
        assertThat(toldAccounts()).as("a door created open to members hands its code to them")
                .containsExactly(janeAccount);
    }

    @Test
    void givenADeactivatedClubhouseDoor_whenItIsActivatedAgain_thenEveryCurrentMemberIsTold() {
        // given
        facility.deactivateAccessPoint(clubhouseDoor);

        // when
        facility.activateAccessPoint(clubhouseDoor);

        // then
        assertThat(toldAccounts()).as("a door that works again hands its code out again").containsExactly(janeAccount);
    }

    @Test
    void givenADoorNotOpenToMembers_whenItsCodeChanges_thenNoMemberIsTold() {
        // given
        UUID northGate = facility.createAccessPoint("North gate", List.of(), OLD_CODE, false);

        // when
        facility.changeAccessPoint(northGate, "North gate", List.of(), NEW_CODE, false);

        // then
        assertThat(toldAccounts()).as("a door kept to bookings tells no member").isEmpty();
    }

    @Test
    void givenMoreCurrentMembersThanOnePage_whenTheCodeChanges_thenEachOfThemIsToldOnce() {
        // given
        List<UUID> current = new ArrayList<>(List.of(janeAccount));
        for (int i = 0; i < 100; i++) {
            current.add(member("Mary" + (char) ('a' + i / 26) + (char) ('a' + i % 26), "Major",
                    TODAY.minusMonths(1), null));
        }

        // when
        facility.changeAccessPoint(clubhouseDoor, "Clubhouse door", List.of(), NEW_CODE, true);

        // then
        assertThat(toldAccounts()).as("the walk continues past its first page of a hundred")
                .containsExactlyInAnyOrderElementsOf(current);
    }

    @Test
    void givenAQueuedMessage_whenTheDoorIsNoLongerOpenToMembersAtItsTurn_thenItFailsUnsent() {
        // given
        facility.changeAccessPoint(clubhouseDoor, "Clubhouse door", List.of(), NEW_CODE, true);
        facility.changeAccessPoint(clubhouseDoor, "Clubhouse door", List.of(), NEW_CODE, false);

        // when
        outbox.deliverDue();

        // then
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeast(0)).send(captured.capture());
        assertThat(captured.getAllValues()).as("a code the members may no longer use is not sent").isEmpty();
        assertThat(jdbc.sql("SELECT state, reason FROM message_record WHERE kind = 'MEMBERS_DOOR_CODE_CHANGED'")
                .query().singleRow())
                .containsEntry("state", "FAILED").containsEntry("reason", "AccessWithdrawn");
    }

    @Test
    void givenAQueuedMessage_whenTheMembershipEndsBeforeItsTurn_thenItFailsUnsent() {
        // given
        facility.changeAccessPoint(clubhouseDoor, "Clubhouse door", List.of(), NEW_CODE, true);
        UUID jane = identity.personIdForUsername("doe.jane");
        jdbc.sql("UPDATE member SET ended_on = :today WHERE person_id = :person")
                .param("today", TODAY).param("person", jane).update();

        // when
        outbox.deliverDue();

        // then
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeast(0)).send(captured.capture());
        assertThat(captured.getAllValues()).as("a former member is not handed the door code").isEmpty();
        assertThat(jdbc.sql("SELECT state, reason FROM message_record WHERE kind = 'MEMBERS_DOOR_CODE_CHANGED'")
                .query().singleRow())
                .containsEntry("state", "FAILED").containsEntry("reason", "NoLongerMember");
    }

    private UUID member(String firstName, String lastName, LocalDate startedOn, LocalDate endedOn) {
        String username = (lastName + "." + firstName).toLowerCase();
        UUID person = identity.createPerson(firstName, lastName, firstName.toLowerCase() + "." + lastName.toLowerCase()
                + "@example.org");
        members.addMembershipPeriod(person, membershipType, startedOn, endedOn);
        return identity.createEnabledAccount(person, username, Set.of(Role.MEMBER));
    }

    private List<UUID> toldAccounts() {
        return jdbc.sql("SELECT account_id FROM message_record WHERE kind = 'MEMBERS_DOOR_CODE_CHANGED'")
                .query(UUID.class).list();
    }

    private String bodyTo(String address) throws Exception {
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeast(1)).send(captured.capture());
        for (MimeMessage message : captured.getAllValues()) {
            if (address.equals(message.getAllRecipients()[0].toString())) {
                Object content = message.getContent();
                return content instanceof Multipart multipart
                        ? multipart.getBodyPart(0).getContent().toString() : content.toString();
            }
        }
        throw new AssertionError("Nothing reached " + address);
    }
}
