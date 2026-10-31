package org.courtside.access.internal;

import org.courtside.access.GrantInstruction;
import org.courtside.access.GrantOutcome;
import org.courtside.access.GrantReference;
import org.courtside.access.ProbeOutcome;
import org.courtside.access.RemoteGroup;
import org.courtside.access.Scope;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LoxoneConnectorTest extends LoxoneTestSupport {

    private final UUID grantId = UUID.randomUUID();
    private final String name = LoxoneSimulator.nameOf(grantId);

    @Test
    void whenGranted_thenOneUserHoldsTheWindowTheExpiryActionTheGroupsAndTheCode() {
        // given
        GrantInstruction instruction = instruction(grantId, null, CODE, Set.of(COURT_ONE, COURT_TWO));

        // when
        GrantOutcome outcome = connector.grant(instruction);

        // then
        List<LoxoneSimulator.User> users = simulator.usersNamed(name);
        assertThat(users).hasSize(1);
        LoxoneSimulator.User user = users.getFirst();
        assertThat(outcome).isEqualTo(new GrantOutcome.Accepted(user.uuid));
        assertThat(user.userState).as("a timespan user").isEqualTo(4);
        assertThat(user.validFrom).isEqualTo(simulator.loxoneSeconds(instruction.validFrom()));
        assertThat(user.validUntil).isEqualTo(simulator.loxoneSeconds(instruction.validUntil()));
        assertThat(user.expirationAction).as("the Miniserver deletes the user at its end").isEqualTo(1);
        assertThat(user.changePassword).isFalse();
        assertThat(user.groups).containsExactlyInAnyOrder(simulator.groupUuid("Court 1"),
                simulator.groupUuid("Court 2"));
        assertThat(user.code).isEqualTo(CODE);
        assertThat(simulator.commands()).containsSubsequence("getuserlist2", "addoredituser", "updateuseraccesscode");
    }

    @Test
    void givenALeftoverDuplicate_whenGranted_thenOneUserOfThatNameRemains() {
        // given
        LoxoneSimulator.User kept = simulator.addUser(name, null);
        LoxoneSimulator.User leftover = simulator.addUser(name, null);

        // when
        GrantOutcome outcome = connector.grant(instruction(grantId));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Accepted(kept.uuid));
        assertThat(simulator.usersNamed(name)).extracting(user -> user.uuid).containsExactly(kept.uuid);
        assertThat(simulator.user(leftover.uuid)).isEmpty();
    }

    @Test
    void givenAnInstalledGrant_whenRescheduled_thenWindowAndGroupsChangeAndTheUuidAndCodeStay() {
        // given
        String uuid = installed(grantId);
        clock.advance(Duration.ofHours(5));
        GrantInstruction moved = instruction(grantId, uuid, codeOf(grantId), Set.of(COURT_TWO));

        // when
        GrantOutcome outcome = connector.reschedule(moved);

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Accepted(uuid));
        LoxoneSimulator.User user = simulator.usersNamed(name).getFirst();
        assertThat(simulator.usersNamed(name)).hasSize(1);
        assertThat(user.uuid).isEqualTo(uuid);
        assertThat(user.validFrom).isEqualTo(simulator.loxoneSeconds(moved.validFrom()));
        assertThat(user.validUntil).isEqualTo(simulator.loxoneSeconds(moved.validUntil()));
        assertThat(user.groups).containsExactly(simulator.groupUuid("Court 2"));
        assertThat(user.code).isEqualTo(codeOf(grantId));
    }

    @Test
    void givenAnInstalledGrantAndADuplicate_whenRevoked_thenEveryUserOfThatNameIsGone() {
        // given
        String uuid = installed(grantId);
        simulator.addUser(name, null);

        // when
        GrantOutcome outcome = connector.revoke(new GrantReference(grantId, uuid));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Accepted(uuid));
        assertThat(simulator.usersNamed(name)).isEmpty();
        assertThat(simulator.count("deleteuser")).isEqualTo(2);
    }

    @Test
    void givenNoUserOfThatName_whenRevoked_thenItIsAcceptedAfterTheListing() {
        // when
        GrantOutcome outcome = connector.revoke(new GrantReference(grantId, null));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Accepted(name));
        assertThat(simulator.commands()).contains("getuserlist2").doesNotContain("deleteuser");
    }

    @Test
    void givenAFailingListing_whenRevoked_thenItIsAnUnclearAnswerAndNothingIsDeleted() {
        // given
        String uuid = installed(grantId);
        simulator.force("getuserlist2", 500);

        // when / then
        assertThatThrownBy(() -> connector.revoke(new GrantReference(grantId, uuid)))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("getuserlist2 answered 500");
        assertThat(simulator.usersNamed(name)).hasSize(1);
        assertThat(simulator.count("deleteuser")).isZero();
    }

    @Test
    void givenACodeAnotherUserHolds_whenGranted_thenTheCodeIsClearedAndRejected() {
        // when
        GrantOutcome outcome = connector.grant(instruction(grantId, null, "135790", Set.of(COURT_ONE)));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.CodeRejected());
        assertThat(simulator.usersNamed(name)).singleElement()
                .satisfies(user -> assertThat(user.code).as("the shared code is not on the user").isNull());
    }

    @Test
    void givenACodeAnotherUserHoldsAndAFailingClear_whenGranted_thenItIsAnUnclearAnswer() {
        // given
        simulator.failCodeClearing();

        // when / then
        assertThatThrownBy(() -> connector.grant(instruction(grantId, null, "135790", Set.of(COURT_ONE))))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("updateuseraccesscode could not clear a code another user holds (500)");
    }

    @Test
    void givenACodeTheNfcBlockUses_whenGranted_thenTheCodeIsRejected() {
        // given
        simulator.force("updateuseraccesscode", 409);

        // when
        GrantOutcome outcome = connector.grant(instruction(grantId));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.CodeRejected());
    }

    @Test
    void givenAUserVanishingBeforeItsCode_whenGranted_thenTheGrantIsRetried() {
        // given
        simulator.vanishBeforeCode();

        // when
        GrantOutcome outcome = connector.grant(instruction(grantId));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.RetryLater(Scope.GRANT, null,
                "Miniserver user vanished before its code was set"));
    }

    @Test
    void givenAMappedGroupTheMiniserverDoesNotKnow_whenGranted_thenTheGrantIsRefused() {
        // given
        simulator.removeGroup("Court 1");

        // when
        GrantOutcome outcome = connector.grant(instruction(grantId));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Refused(Scope.GRANT, "Loxone group not found"));
        assertThat(simulator.usersNamed(name)).isEmpty();
    }

    @Test
    void givenATakenName_whenTheUserIsCreated_thenItIsAnUnclearAnswer() {
        // given
        simulator.takeNameOnCreate();

        // when / then
        assertThatThrownBy(() -> connector.grant(instruction(grantId)))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("addoredituser answered 400: the user name is taken");
    }

    @Test
    void givenAMiniserverRenamingTheUser_whenGranted_thenTheRenamedUserIsDeletedAndTheConnectorRefused() {
        // given
        simulator.renameUsers();
        String renamed = name.substring(0, name.length() - 1) + "_";

        // when
        GrantOutcome outcome = connector.grant(instruction(grantId));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Refused(Scope.CONNECTOR, "Miniserver changed the user name"));
        assertThat(simulator.usersNamed(renamed)).as("no user later listings cannot find stays behind").isEmpty();
        assertThat(simulator.usersNamed(name)).isEmpty();
    }

    @Test
    void givenAnAdminGroupMapped_whenGranted_thenTheGrantIsRefusedWithoutARequest() {
        // given
        mapping.put(COURT_ONE, simulator.groupUuid("Administrators"));

        // when
        GrantOutcome outcome = connector.grant(instruction(grantId));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Refused(Scope.GRANT, "Loxone group is not a normal group"));
        assertThat(simulator.requests()).isEmpty();
    }

    @Test
    void givenAConnectorThatHasReadNoGroups_whenGranted_thenTheGrantIsRefusedWithoutARequest() {
        // given
        LoxoneAccessControl unprobed = connectorFor(simulator.settingsByUrl(DEADLINE));

        // when
        GrantOutcome outcome = unprobed.grant(instruction(grantId));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Refused(Scope.GRANT, "Loxone group is not a normal group"));
        assertThat(simulator.requests()).isEmpty();
    }

    @Test
    void givenAnAccessPointWithoutAGroup_whenGranted_thenTheGrantIsRefusedWithoutARequest() {
        // given
        mapping.remove(COURT_TWO);

        // when
        GrantOutcome outcome = connector.grant(instruction(grantId, null, CODE, Set.of(COURT_ONE, COURT_TWO)));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Refused(Scope.GRANT, "access point has no Loxone group"));
        assertThat(simulator.requests()).isEmpty();
    }

    @Test
    void givenAHangingRequest_whenGranted_thenTheCallEndsWithinItsDeadline() {
        // given
        LoxoneAccessControl bounded = ready(connectorFor(simulator.settingsByUrl(Duration.ofSeconds(1))));
        simulator.hang("getuserlist2");
        long started = System.nanoTime();

        // when / then
        assertThatThrownBy(() -> bounded.grant(instruction(grantId)))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("no answer to getuserlist2 within the call deadline");
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(1_800));
    }

    @Test
    void givenAHangingRequest_whenTheCallIsInterrupted_thenItStopsAtOnce() throws InterruptedException {
        // given
        simulator.hang("getuserlist2");
        AtomicReference<Throwable> failure = new AtomicReference<>();
        AtomicReference<Boolean> stillInterrupted = new AtomicReference<>();
        Thread call = Thread.ofPlatform().start(() -> {
            try {
                connector.grant(instruction(grantId));
            } catch (RuntimeException failed) {
                failure.set(failed);
            }
            stillInterrupted.set(Thread.currentThread().isInterrupted());
        });
        long waiting = System.nanoTime();
        while (simulator.count("getuserlist2") == 0 && call.isAlive()
                && System.nanoTime() - waiting < Duration.ofSeconds(5).toNanos()) {
            Thread.onSpinWait();
        }
        long started = System.nanoTime();

        // when
        call.interrupt();
        call.join(Duration.ofSeconds(5));

        // then
        assertThat(call.isAlive()).isFalse();
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(2));
        assertThat(failure.get()).isInstanceOf(LoxoneFailure.class).hasMessage("interrupted during getuserlist2");
        assertThat(stillInterrupted.get()).as("the interrupt stays visible to the caller").isTrue();
    }

    @Test
    void givenAnUndocumentedCode_whenGranted_thenItIsAnUnclearAnswer() {
        // given
        simulator.force("updateuseraccesscode", 406);

        // when / then
        assertThatThrownBy(() -> connector.grant(instruction(grantId)))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("updateuseraccesscode answered 406");
    }

    @Test
    void givenRepliesEchoingTheToken_whenAnswersAreDescribed_thenNoTokenOrAddressReachesTheText() {
        // given
        installed(UUID.randomUUID());
        simulator.force("getuserlist2", 418);

        // when
        Throwable unclear = catchFailure(() -> connector.grant(instruction(grantId)));
        simulator.force("getuserlist2", 403);
        GrantOutcome refused = connector.grant(instruction(grantId));

        // then
        Set<String> texts = Set.of(unclear.getMessage(), ((GrantOutcome.Refused) refused).reason());
        assertThat(simulator.issuedTokens()).isNotEmpty();
        assertThat(texts).allSatisfy(text -> {
            assertThat(simulator.issuedTokens()).noneMatch(text::contains);
            assertThat(text).doesNotContain("autht", "localhost", "https", LoxoneSimulator.PASSWORD);
        });
        assertThat(unclear.getCause()).as("a transport exception may carry the address").isNull();
    }

    @Test
    void givenAccessPoints_whenTheMappingIsRead_thenItIsSortedStableBoundedAndFollowsAGroupChange() {
        // given
        String both = connector.mappingOf(Set.of(COURT_ONE, COURT_TWO));
        String reversed = connector.mappingOf(new HashSet<>(List.of(COURT_TWO, COURT_ONE)));
        String one = connector.mappingOf(Set.of(COURT_ONE));
        Set<UUID> many = new HashSet<>();
        IntStream.range(0, 12).forEach(index -> {
            UUID point = UUID.randomUUID();
            mapping.put(point, "0000000" + Integer.toHexString(index) + "-0000-0000-0000000000000000");
            many.add(point);
        });

        // when
        mapping.put(COURT_ONE, simulator.groupUuid("Members"));
        String changed = connector.mappingOf(Set.of(COURT_ONE, COURT_TWO));
        mapping.remove(COURT_ONE);
        String unmapped = connector.mappingOf(Set.of(COURT_ONE, COURT_TWO));

        // then
        assertThat(both).isEqualTo(reversed).isNotEqualTo(one).contains(simulator.groupUuid("Court 1"));
        assertThat(changed).isNotEqualTo(both);
        assertThat(unmapped).isNotEqualTo(both).isNotEqualTo(connector.mappingOf(Set.of(COURT_TWO)));
        assertThat(connector.mappingOf(many)).hasSizeLessThanOrEqualTo(200)
                .isEqualTo(connector.mappingOf(Set.copyOf(many)));
        assertThat(simulator.requests()).as("the mapping is a local read").isEmpty();
    }

    @Test
    void whenProbed_thenTheNormalGroupsAreKept() {
        // when
        ProbeOutcome probed = connector.probe();

        // then
        assertThat(probed).isEqualTo(new ProbeOutcome.Answered());
        assertThat(connector.groups()).containsExactly(
                new RemoteGroup(simulator.groupUuid("Members"), "Members"),
                new RemoteGroup(simulator.groupUuid("Court 1"), "Court 1"),
                new RemoteGroup(simulator.groupUuid("Court 2"), "Court 2"));
        assertThat(simulator.commands()).contains("getuserlist2", "getgrouplist");
    }

    @Test
    void givenAnEarlierProbe_whenAProbeFails_thenThePreviousGroupsStay() {
        // given
        connector.probe();
        List<RemoteGroup> read = connector.groups();
        simulator.removeGroup("Court 2");
        simulator.force("getgrouplist", 500);

        // when
        Throwable unclear = catchFailure(connector::probe);
        simulator.force("getgrouplist", 403);
        ProbeOutcome refused = connector.probe();

        // then
        assertThat(unclear).hasMessage("getgrouplist answered 500");
        assertThat(refused).isEqualTo(new ProbeOutcome.Refused("Miniserver denied getgrouplist (403)"));
        assertThat(connector.groups()).hasSize(3).isEqualTo(read);
    }

    @Test
    void givenCourtsideAndForeignUsers_whenTheRemoteGrantIdsAreListed_thenOnlyNonAdminCourtsideNamesCount() {
        // given
        installed(grantId);

        // when
        Set<UUID> listed = connector.remoteGrantIds().orElseThrow();

        // then
        assertThat(listed).as("a lookalike name, an upper-case one and an admin are not Courtside users")
                .containsExactlyInAnyOrder(grantId, simulator.foreignGrantId())
                .doesNotContain(simulator.adminGrantId());
    }

    @Test
    void givenAnAdminNamedLikeTheGrant_whenRevoked_thenItIsAnUnclearAnswerAndNothingIsDeleted() {
        // when / then
        assertThatThrownBy(() -> connector.revoke(new GrantReference(simulator.adminGrantId(), null)))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("getuserlist2 lists a user of this grant the connector may not change");
        assertThat(simulator.count("deleteuser")).isZero();
    }

    @Test
    void givenAUserOfTheGrantWithAMalformedUuid_whenRevokedOrGranted_thenEachIsAnUnclearAnswerAndNothingChanges() {
        // given
        simulator.addUser(name, "not-a-loxone-uuid", false);

        // when / then
        assertThatThrownBy(() -> connector.revoke(new GrantReference(grantId, null)))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("getuserlist2 lists a user of this grant the connector may not change");
        assertThatThrownBy(() -> connector.grant(instruction(grantId)))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("getuserlist2 lists a user of this grant the connector may not change");
        assertThat(simulator.commands()).doesNotContain("deleteuser", "addoredituser", "updateuseraccesscode");
        assertThat(simulator.usersNamed(name)).hasSize(1);
    }

    @Test
    void givenADeletionTheMiniserverDidNotApply_whenRevoked_thenItIsAnUnclearAnswer() {
        // given
        String uuid = installed(grantId);
        simulator.ignoreDeletes();

        // when / then
        assertThatThrownBy(() -> connector.revoke(new GrantReference(grantId, uuid)))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("getuserlist2 still lists a user of this grant after deleteuser");
    }

    private static Throwable catchFailure(Runnable call) {
        try {
            call.run();
        } catch (LoxoneFailure failed) {
            return failed;
        }
        throw new AssertionError("the call was expected to give an unclear answer");
    }
}
