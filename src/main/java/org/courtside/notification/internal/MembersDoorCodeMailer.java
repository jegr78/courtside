package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.facility.AccessPoint;
import org.courtside.facility.FacilityEvent;
import org.courtside.facility.FacilityService;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.MemberService;
import org.courtside.notification.MessageKind;
import org.courtside.shared.DoorCodeAudience;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.BiFunction;
import java.util.function.Consumer;

@Component
@RequiredArgsConstructor
class MembersDoorCodeMailer implements MessageComposer {

    private static final int PAGE_SIZE = 100;
    private static final UUID FIRST = new UUID(0, 0);

    private final MemberService members;
    private final DoorCodeAudience audience;
    private final FacilityService facility;
    private final UserAccountRepository accounts;
    private final ClubIdentity club;
    private final MailTemplates templates;
    private final InstanceLinks links;
    private final MessageOutbox outbox;
    private final PlatformTransactionManager transactionManager;

    @Async("membersDoorCodeExecutor")
    @TransactionalEventListener
    void on(FacilityEvent.MembersDoorCodeChanged changed) {
        TransactionTemplate transactions = new TransactionTemplate(transactionManager);
        transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        Map<String, String> parameters = Map.of(QueuedMessage.ACCESS_POINT, changed.accessPointId().toString());
        Consumer<UUID> tell = accountId -> outbox.queue(accountId, MessageKind.MEMBERS_DOOR_CODE_CHANGED, parameters);
        walk(transactions, members::currentMemberAccountIdsAfter, tell);
        walk(transactions, audience::bookersAfter, accountId -> {
            if (!members.isCurrentMember(accountId) && audience.includes(accountId)) {
                tell.accept(accountId);
            }
        });
    }

    private static void walk(TransactionTemplate transactions, BiFunction<UUID, Integer, List<UUID>> pages,
                             Consumer<UUID> tell) {
        UUID after = FIRST;
        List<UUID> page;
        do {
            page = pages.apply(after, PAGE_SIZE);
            List<UUID> told = page;
            transactions.executeWithoutResult(status -> told.forEach(tell));
            after = page.isEmpty() ? after : page.getLast();
        } while (page.size() == PAGE_SIZE);
    }

    @Override
    public Set<MessageKind> kinds() {
        return Set.of(MessageKind.MEMBERS_DOOR_CODE_CHANGED);
    }

    // The code is read when the message is written, so a second change before then sends the latest one.
    @Override
    public void compose(QueuedMessage message, Consumer<OutgoingMail> handOver) {
        if (!audience.includes(message.accountId())) {
            throw new MessageUndeliverableException("NoLongerEntitled");
        }
        UUID accessPointId = message.accessPoint();
        AccessPoint door = facility.membersDoorCodes().stream()
                .filter(open -> open.getId().equals(accessPointId))
                .findFirst()
                .orElseThrow(() -> new MessageUndeliverableException("AccessWithdrawn"));
        UserAccount account = MessageRecipient.required(accounts, message.accountId());
        Locale locale = MessageLanguage.of(account.getLocale(), club.defaultLocale());
        String key = MessageKind.MEMBERS_DOOR_CODE_CHANGED.templateKey();
        Map<String, String> values = Map.of(
                "clubName", club.clubName(),
                "firstName", account.getPerson().getFirstName(),
                BookingWording.ACCESS_CODES, templates.render("booking.access.code", locale,
                        Map.of("accessPoint", door.getName(), "accessCode", door.getStaticCode())),
                InstanceLinks.PLACEHOLDER, links.of(message));
        handOver.accept(new OutgoingMail(account.getPerson().getEmail(),
                templates.render(key + ".subject", locale, values),
                templates.render(key + ".body", locale, values)));
    }
}
