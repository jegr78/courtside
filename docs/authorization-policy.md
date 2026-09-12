# Authorization policy

> Generated from `security/authorization-policy.json`; edit the maintained policy, not this file.

This is the normative authorization policy for the shipped Courtside API. OpenAPI defines the transport shape; this policy defines who may perform each operation, which resource attributes narrow that permission, and which protected fields each projection may read or write.

The maintained JSON classifies every reachable OpenAPI field either as ordinary or under one of the protected-field rules below. Ordinary fields inherit their operation rule without an additional ownership or workflow restriction. Fingerprints bind that classification and the named production authorization methods to the reviewed code.

## Principals

| Principal | Meaning |
|---|---|
| `ANONYMOUS` | A caller without an authenticated Courtside session. |
| `MEMBER` | An authenticated account holding the ordinary member role. |
| `TRAINER` | An authenticated account holding the trainer role. |
| `SPORT_DIRECTOR` | An authenticated account holding the sport-director role. |
| `YOUTH_DIRECTOR` | An authenticated account holding the youth-director role. |
| `GROUNDSKEEPER` | An authenticated account holding the groundskeeper role. |
| `TREASURER` | An authenticated account holding the treasurer role. |
| `ADMIN` | An authenticated account holding the instance administrator role. |
| `INITIAL_PASSWORD` | An authenticated account restricted to replacing its issued one-time password. |

## Resource attributes

| Attribute | Meaning |
|---|---|
| `account-enabled` | Whether the authenticated account remains enabled. |
| `administrator` | Whether the current account carries ADMIN authority. |
| `administrator-override` | The explicit ADMIN override for a booking role or ownership rule. |
| `allowed-role` | Whether at least one current account role occurs in the booking card allowlist. |
| `authenticated-at` | The server-side instant of the session's latest full password proof. |
| `authenticated-session` | Whether a valid server-side session resolves to an account. |
| `booking-card` | The booking card attached to the requested booking or series. |
| `booking-card-active` | Whether the selected booking card remains active. |
| `participant-card-active` | Whether a participant card remains active and may be offered for a new booking. |
| `booking-owner` | Whether the current account created the selected booking. |
| `current-account` | The account derived from the authenticated session rather than request input. |
| `current-membership` | Whether a referenced person holds a membership that has not ended. |
| `current-session` | Whether a session record is the browser session making the request. |
| `dedicated-workflow` | Whether a protected value enters through the one operation intended to handle it. |
| `enabled-administrator-count` | The number of other enabled accounts that retain ADMIN authority. |
| `five-minute-window` | Whether the latest full password proof is no older than five minutes. |
| `managing-role` | Whether a current account role occurs in the booking card manager list. |
| `occurrence-scope` | The whole-series, following-occurrences or single-occurrence scope requested. |
| `participant-person` | Whether the current person is the participation record being changed. |
| `participant-schema` | Whether the response uses the bounded participant-member projection. |
| `password-change-required` | Whether the account is restricted to replacing an issued credential. |
| `permanent-account` | Whether the account has replaced its issued credential with a permanent password. |
| `preview-current` | Whether the import preview is neither superseded nor expired. |
| `preview-expiry` | The server-side expiry instant attached to the import preview. |
| `preview-reviewer` | The account that created and is permitted to execute the import preview. |
| `public-schema` | Whether the response uses the dedicated public OpenAPI projection. |
| `recent-authentication` | Whether the current session satisfies the recent full-password proof rule. |
| `request-field` | The exact OpenAPI request field through which a protected value may enter. |
| `requested-enabled-state` | The enabled state requested for the target account. |
| `requested-roles` | The complete replacement role set requested for the target account. |
| `response-schema` | The explicit OpenAPI response projection produced by the operation. |
| `role` | A product role resolved from the current account's granted authorities. |
| `roster-fingerprint` | The preview-time digest of every roster record the import would touch. |
| `route` | The normalized request path matched by the server authorization chain. |
| `series-owner` | Whether the current account created the selected booking series. |
| `session-handle` | The opaque revocation handle scoped to one account session. |
| `source-version` | The import source version against which the preview was prepared. |
| `subject-person` | The one person whose records a subject-access response may contain. |
| `target-account` | The account whose roles, status, credentials or sessions are being administered. |
| `target-person` | The person whose roster projection or identity data is being administered. |
| `viewer-account` | The optional current account used to select viewer-specific public fields. |

## Operation rules

| Rule | Operations | Admitted actors | Required decisions |
|---|---|---|---|
| `public-platform-and-session-boundary` | `getSourceOffer`, `getApiDocument`, `getSessionStatus`, `logOut` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD` | `request-boundary` |
| `public-login-boundary` | `logIn` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD` | `request-boundary`, `credential-write-only` |
| `public-club-and-calendar` | `listCourts`, `listOpeningHours`, `getBookingGrid`, `getClubConfig`, `getClubLogo`, `getWebManifest`, `listAllocations` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD` | `request-boundary`, `public-projection` |
| `initial-password-replacement` | `changeInitialPassword` | `INITIAL_PASSWORD` | `initial-password-gate`, `credential-write-only` |
| `own-account-preferences-and-session-list` | `listOwnSessions`, `changeOwnLocale`, `listOwnMessageChoices`, `chooseOwnMessages` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `own-account-scope` |
| `own-credential-proof-and-replacement` | `reauthenticate`, `changeOwnPassword` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `own-account-scope`, `credential-write-only` |
| `own-session-termination` | `endOwnSessions`, `endOwnSession` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `own-account-scope`, `recent-authentication` |
| `authenticated-booking-card-discovery` | `listBookableCards` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `booking-card-eligibility` |
| `authenticated-participant-card-discovery` | `listParticipantCards` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `participant-card-availability` |
| `authenticated-member-directory` | `searchParticipantMembers` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `member-directory-projection` |
| `booking-create-and-preview` | `createBooking`, `getBookingEligibility`, `previewSeries`, `createSeries` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `booking-card-eligibility` |
| `own-booking-and-participation` | `cancelBooking`, `listPersonalBookings`, `listOwnParticipations`, `removeOwnParticipation` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `booking-ownership` |
| `managed-booking` | `listManagedAppointments`, `getManagedAppointment` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `managed-booking-scope` |
| `owned-series` | `cancelSeries`, `previewSeriesMove`, `moveSeries` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `series-ownership` |
| `administration` | `listCourtsForAdmin`, `createCourt`, `getCourt`, `changeCourt`, `setCourtActive`, `listBookingCards`, `createBookingCard`, `getBookingCard`, `changeBookingCard`, `setBookingCardActive`, `listParticipantCardsForAdmin`, `createParticipantCard`, `getParticipantCard`, `changeParticipantCard`, `setParticipantCardActive`, `listMembershipTypes`, `createMembershipType`, `getMembershipType`, `changeMembershipType`, `setMembershipTypeActive`, `searchRoster`, `createPerson`, `readPerson`, `changeAccountLocale`, `assignMembership`, `removeMembership`, `listSupportedEncodings`, `listImportSources`, `createImportSource`, `readImportSource`, `changeImportSource`, `deleteImportSource`, `listExternalReferences`, `linkExternalReference`, `unlinkExternalReference`, `createImportPreview`, `readImportPreview`, `listImportRuns`, `listRuleSets`, `createRuleSet`, `listRuleTypes`, `getRuleSet`, `changeRuleSet`, `setRuleSetActive`, `listOpeningHoursForAdmin`, `setWeeklyOpeningHours`, `getClubConfigForAdmin`, `changeClubConfig`, `uploadClubLogo`, `deleteClubLogo`, `listRules`, `setRule`, `removeRule`, `courtImpact`, `bookingCardImpact`, `openingHoursImpact`, `facilityUtilisation`, `readMessageLog`, `readAuditLog`, `exportRoster`, `exportBookings`, `exportPersonData` | `ADMIN` | `administrator-gate`, `administrative-projection` |
| `recent-person-administration` | `changePerson` | `ADMIN` | `administrator-gate`, `recent-authentication`, `administrative-projection` |
| `recent-account-administration` | `createAccount`, `changeAccountUsername`, `requestAccountCredentials`, `endAccountSessions` | `ADMIN` | `administrator-gate`, `recent-authentication`, `administrative-projection` |
| `continuity-protected-account-administration` | `changeAccountRoles`, `setAccountActive` | `ADMIN` | `administrator-gate`, `recent-authentication`, `administrator-continuity`, `administrative-projection` |
| `global-session-termination` | `endAllSessions` | `ADMIN` | `administrator-gate`, `recent-authentication` |
| `import-execution` | `executeImportPreview` | `ADMIN` | `administrator-gate`, `recent-authentication`, `import-preview-owner`, `administrative-projection` |

## Authorization decisions

### Public request boundary

Only explicitly public routes admit an anonymous caller; all other shipped operations require a valid server-side session.

Attributes: `route`, `authenticated-session`, `account-enabled`, `password-change-required`.

Production: `src/main/java/org/courtside/identity/internal/SecurityConfiguration.java#filterChain`, `src/main/java/org/courtside/identity/internal/LoginAttemptFilter.java#doFilterInternal`, `src/main/java/org/courtside/identity/internal/SessionStatusController.java#getSessionStatus`.

Positive tests: `src/test/java/org/courtside/identity/AdminSurfaceTest.java#givenAnAnonymousCaller_whenCallingEveryAnonymousAllowedEndpoint_thenEveryOneOfThemSucceeds`.

Negative tests: `src/test/java/org/courtside/identity/AdminSurfaceTest.java#givenAnAnonymousCaller_whenCallingEveryAuthenticatedEndpoint_thenEveryOneOfThemIsUnauthorized`.

### Permanent account gate

Ordinary account operations require an authenticated, enabled account whose issued credential has already been replaced by a permanent password.

Attributes: `authenticated-session`, `account-enabled`, `password-change-required`.

Production: `src/main/java/org/courtside/identity/internal/SecurityConfiguration.java#filterChain`.

Positive tests: `src/test/java/org/courtside/identity/AdminSurfaceTest.java#givenAnAuthenticatedMember_whenCallingEveryAuthenticatedEndpoint_thenNoneOfThemIsUnauthorized`.

Negative tests: `src/test/java/org/courtside/identity/AdminSurfaceTest.java#givenEveryInitialPasswordRole_whenCallingEveryMappedEndpoint_thenOnlyPublicAndReplacementOperationsPassAuthorization`.

### Initial password gate

The initial-password authority reaches only password replacement and loses all authority when that replacement succeeds.

Attributes: `authenticated-session`, `password-change-required`.

Production: `src/main/java/org/courtside/identity/internal/SecurityConfiguration.java#filterChain`, `src/main/java/org/courtside/identity/internal/InitialPasswordService.java#change`, `src/main/java/org/courtside/identity/internal/BootstrapAdminInitializer.java#run`, `src/main/java/org/courtside/identity/internal/CourtsideUserDetailsService.java#loadUserByUsername`.

Positive tests: `src/test/java/org/courtside/identity/LoginTest.java#givenTheBootstrapAdmin_whenChangingTheInitialPassword_thenTheOldPasswordStopsWorking`.

Negative tests: `src/test/java/org/courtside/identity/AdminSurfaceTest.java#givenEveryInitialPasswordRole_whenCallingEveryMappedEndpoint_thenOnlyPublicAndReplacementOperationsPassAuthorization`.

### Administrator gate

Every route below /api/admin requires ADMIN and rejects anonymous, initial-password and every non-admin product role before the operation runs.

Attributes: `route`, `role`, `password-change-required`.

Production: `src/main/java/org/courtside/identity/internal/SecurityConfiguration.java#filterChain`.

Positive tests: `src/test/java/org/courtside/identity/AdminAuthorizationTest.java#givenAnAdmin_whenCallingAnAdminEndpoint_thenItIsServed`.

Negative tests: `src/test/java/org/courtside/identity/AdminAuthorizationTest.java#givenEveryProductRole_whenCallingAnAdminEndpoint_thenOnlyAdminIsServed`.

### Own account scope

The authenticated account identifier selects session, locale and message-choice state; callers cannot supply another account identifier to these operations.

Attributes: `current-account`, `session-handle`.

Production: `src/main/java/org/courtside/identity/CurrentUser.java#requireAccount`, `src/main/java/org/courtside/identity/internal/AccountSessionService.java#list`, `src/main/java/org/courtside/identity/internal/AccountSessionService.java#endOne`, `src/main/java/org/courtside/identity/internal/AccountSessionService.java#endAll`, `src/main/java/org/courtside/identity/internal/AccountLocaleService.java#change`, `src/main/java/org/courtside/notification/internal/OwnMessageChoices.java#current`, `src/main/java/org/courtside/notification/internal/OwnMessageChoices.java#choose`, `src/main/java/org/courtside/notification/internal/OwnMessageChoices.java#accountId`.

Positive tests: `src/test/java/org/courtside/identity/AccountSessionLifecycleTest.java#givenTwoActiveSessions_whenOneIsListedAndEnded_thenOnlyPrivacySafeMetadataAndTheOtherRemain`.

Negative tests: `src/test/java/org/courtside/identity/internal/AccountSessionServiceTest.java#givenAnUnknownHandle_whenASessionIsEnded_thenNothingIsDeleted`.

### Credential write-only boundary

Passwords are accepted only by their dedicated credential workflows, never returned in a response and never accepted by account administration.

Attributes: `dedicated-workflow`, `request-field`.

Production: `src/main/java/org/courtside/identity/internal/SecurityConfiguration.java#loginEndpoint`, `src/main/java/org/courtside/identity/internal/AccountController.java#changeInitialPassword`, `src/main/java/org/courtside/identity/internal/AccountController.java#changeOwnPassword`, `src/main/java/org/courtside/identity/internal/PermanentPasswordService.java#change`, `src/main/java/org/courtside/identity/internal/ReauthenticationService.java#reauthenticate`, `src/main/java/org/courtside/member/web/RosterAdminController.java#createAccount`.

Positive tests: `src/test/java/org/courtside/identity/PermanentPasswordChangeTest.java#givenTwoActiveSessions_whenThePasswordIsReplaced_thenBothEndAndOnlyTheReplacementSignsIn`.

Negative tests: `src/test/java/org/courtside/member/web/RosterAdminControllerTest.java#givenARequestStillCarryingAPassword_whenCreatingAnAccount_thenTheContractRefusesIt`.

### Booking card role and state

A booking card must be active and admit at least one actor role; ADMIN bypasses the card role list but not facility availability or invariant checks.

Attributes: `booking-card`, `booking-card-active`, `allowed-role`, `administrator-override`.

Production: `src/main/java/org/courtside/booking/internal/CardEligibilityPolicy.java#requireEligible`, `src/main/java/org/courtside/booking/internal/BookingRuleGate.java#bookingEligibilityFor`, `src/main/java/org/courtside/booking/internal/BookingRuleGate.java#maxBookingMinutesFor`, `src/main/java/org/courtside/booking/internal/BookingRuleGate.java#requireCancellationAllowed`, `src/main/java/org/courtside/booking/internal/BookingRuleGate.java#restrictionsApplyTo`, `src/main/java/org/courtside/booking/BookingWriter.java#write/3`, `src/main/java/org/courtside/card/CardService.java#bookableCards`, `src/main/java/org/courtside/card/web/CardController.java#callerRoles`, `src/main/java/org/courtside/booking/series/SeriesService.java#create`, `src/main/java/org/courtside/booking/web/BookingController.java#getBookingEligibility`, `src/main/java/org/courtside/booking/web/BookingController.java#createBooking`, `src/main/java/org/courtside/booking/web/SeriesController.java#createSeries`, `src/main/java/org/courtside/booking/web/SeriesController.java#previewSeries`.

Positive tests: `src/test/java/org/courtside/booking/internal/CardEligibilityPolicyTest.java#givenTheRequiredRole_whenRequiringEligibility_thenTheCardIsReturned`.

Negative tests: `src/test/java/org/courtside/booking/internal/CardEligibilityPolicyTest.java#givenOnlyAnotherRole_whenRequiringEligibility_thenTheRoleFailureIsRaised`.

### Booking and participation ownership

Personal queries derive identity from the current account; cancellation requires the booking owner or ADMIN and withdrawal removes only the current person's participation.

Attributes: `current-account`, `booking-owner`, `participant-person`, `administrator-override`.

Production: `src/main/java/org/courtside/booking/BookingService.java#cancel`, `src/main/java/org/courtside/booking/BookingWriter.java#cancel`, `src/main/java/org/courtside/booking/Booking.java#withdrawParticipant`, `src/main/java/org/courtside/booking/internal/BookingAccessControl.java#requireManagementAccess`, `src/main/java/org/courtside/booking/internal/BookingAccessControl.java#requireRoleManagementAccess`, `src/main/java/org/courtside/booking/internal/BookingAccessControl.java#managementRoles`, `src/main/java/org/courtside/booking/ParticipationService.java#withdraw`, `src/main/java/org/courtside/booking/web/BookingController.java#listPersonalBookings`, `src/main/java/org/courtside/booking/web/BookingController.java#listOwnParticipations`, `src/main/java/org/courtside/booking/web/BookingController.java#removeOwnParticipation`, `src/main/java/org/courtside/booking/web/BookingController.java#cancelBooking`.

Positive tests: `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenAnOwnBooking_whenCancellingIt_thenItDisappearsFromTheGrid`.

Negative tests: `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenAForeignBooking_whenAMemberCancelsIt_thenItIsNotFoundAndItStaysConfirmed`.

### Participant card availability

Participant-card discovery returns active cards only; it has no booking-card role allowlist or administrator override.

Attributes: `participant-card-active`.

Production: `src/main/java/org/courtside/card/CardService.java#activeParticipantCards`, `src/main/java/org/courtside/card/web/CardController.java#listParticipantCards`.

Positive tests: `src/test/java/org/courtside/card/web/CardControllerTest.java#givenAnActiveAndADeactivatedParticipantCard_whenListingPublicly_thenOnlyTheActiveOneIsPresent`.

Negative tests: `src/test/java/org/courtside/card/web/CardControllerTest.java#givenAnAnonymousCaller_whenListingParticipantCardsPublicly_thenItIsUnauthorized`.

### Managed booking scope

Managed listings and details contain only bookings whose card names one of the actor roles as a managing role; ADMIN sees every card.

Attributes: `booking-card`, `managing-role`, `administrator-override`.

Production: `src/main/java/org/courtside/booking/BookingRepository.java#findManagedBookingIds`, `src/main/java/org/courtside/booking/internal/ManagedAppointmentQuery.java#list`, `src/main/java/org/courtside/booking/internal/ManagedAppointmentQuery.java#get`, `src/main/java/org/courtside/booking/web/BookingController.java#listManagedAppointments`, `src/main/java/org/courtside/booking/web/BookingController.java#getManagedAppointment`.

Positive tests: `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenAnOfficerAppointment_whenListingManagedAppointments_thenBothResponsibleRolesSeeIt`, `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenACardManagedByTrainers_whenATrainerOpensAnAppointmentOnIt_thenTheParticipantsAreShown`.

Negative tests: `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenAnOfficerAppointment_whenAnOrdinaryMemberListsManagedAppointments_thenNothingIsDisclosed`, `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenACardBookableByMembersAndTrainers_whenATrainerOpensAMemberAppointment_thenItIsRefused`.

### Series ownership and management

Moving or cancelling a series requires its creator, a role that manages the series booking card, or ADMIN; the selected occurrence scope is preserved.

Attributes: `series-owner`, `booking-card`, `managing-role`, `administrator-override`, `occurrence-scope`.

Production: `src/main/java/org/courtside/booking/series/SeriesService.java#requireManagementAccessTo`, `src/main/java/org/courtside/booking/series/SeriesService.java#previewMove/4`, `src/main/java/org/courtside/booking/web/SeriesController.java#cancelSeries`, `src/main/java/org/courtside/booking/web/SeriesController.java#moveSeries`, `src/main/java/org/courtside/booking/web/SeriesController.java#previewSeriesMove`.

Positive tests: `src/test/java/org/courtside/booking/series/SeriesMovePreviewTest.java#givenATrainingSeriesCreatedByATrainer_whenAYouthDirectorPreviewsAMove_thenItIsAllowed`.

Negative tests: `src/test/java/org/courtside/booking/series/SeriesMovePreviewTest.java#givenTheCallerDoesNotOwnTheSeriesAndIsNotAdmin_whenPreviewingAMove_thenItIsRejected`.

### Recent full-password proof

Sensitive account administration, another browser's session termination and import execution require a successful full-password proof no older than five minutes.

Attributes: `authenticated-at`, `current-session`, `five-minute-window`.

Production: `src/main/java/org/courtside/identity/RecentAuthentication.java#requireRecent`, `src/main/java/org/courtside/identity/GlobalSessionAdministration.java#endAll`, `src/main/java/org/courtside/member/web/RosterAdminController.java#changePerson`, `src/main/java/org/courtside/member/web/RosterAdminController.java#createAccount`, `src/main/java/org/courtside/member/web/RosterAdminController.java#changeAccountRoles`, `src/main/java/org/courtside/member/web/RosterAdminController.java#changeAccountUsername`, `src/main/java/org/courtside/member/web/RosterAdminController.java#requestAccountCredentials`, `src/main/java/org/courtside/member/web/RosterAdminController.java#setAccountActive`, `src/main/java/org/courtside/member/web/RosterAdminController.java#endAccountSessions`, `src/main/java/org/courtside/member/web/RosterAdminController.java#endAllSessions`, `src/main/java/org/courtside/dataexchange/web/ImportExecutionAdminController.java#executeImportPreview`.

Positive tests: `src/test/java/org/courtside/identity/AdminRecentAuthenticationTest.java#givenAnotherAccountsSessions_whenAdminProofIsRefreshed_thenOnlyTheTargetEnds`.

Negative tests: `src/test/java/org/courtside/identity/AdminRecentAuthenticationTest.java#givenNoRecentProof_whenAnAdminPerformsSensitiveChanges_thenEveryChangeIsRefused`.

### Administrator continuity

The last enabled administrator cannot remove its ADMIN role or disable its account; another enabled administrator makes the same transition permissible.

Attributes: `target-account`, `enabled-administrator-count`, `requested-roles`, `requested-enabled-state`.

Production: `src/main/java/org/courtside/member/RosterService.java#changeRoles`, `src/main/java/org/courtside/member/RosterService.java#requireASuccessorAdministrator`, `src/main/java/org/courtside/member/RosterSyncService.java#withdrawMembershipFrom`.

Positive tests: `src/test/java/org/courtside/member/web/RosterAdminControllerTest.java#givenASecondEnabledAdministrator_whenOneStepsDown_thenTheChangeStands`.

Negative tests: `src/test/java/org/courtside/member/web/RosterAdminControllerTest.java#givenTheOnlyEnabledAdministrator_whenTheRoleIsTakenFromThem_thenTheInstanceKeepsIt`.

### Import preview ownership and state

Only the administrator who created a current, unexpired preview may execute it, and execution rechecks its source and roster fingerprints before any write.

Attributes: `preview-reviewer`, `preview-current`, `preview-expiry`, `source-version`, `roster-fingerprint`.

Production: `src/main/java/org/courtside/dataexchange/ExecutionService.java#execute`, `src/main/java/org/courtside/dataexchange/ExecutionService.java#requireExecutable`, `src/main/java/org/courtside/dataexchange/ExecutionService.java#requireSameActor`, `src/main/java/org/courtside/dataexchange/ExecutionService.java#requireNobodyChangedSince`.

Positive tests: `src/test/java/org/courtside/dataexchange/ExecutionServiceTest.java#givenAReviewedPreview_whenItIsExecuted_thenEveryRecordExistsAndIsLinked`.

Negative tests: `src/test/java/org/courtside/dataexchange/ExecutionServiceTest.java#givenAnotherAdministratorTookThePreview_whenExecutingIt_thenOnlyItsReviewerCanProceed`.

### Import preview read projection

Every administrator may read a stored preview; after its retention expires, personal change details and ignored columns are removed while non-personal counts and hashes remain.

Attributes: `administrator`, `preview-expiry`, `response-schema`.

Production: `src/main/java/org/courtside/dataexchange/PreviewService.java#toSummary`, `src/main/java/org/courtside/dataexchange/web/ImportPreviewAdminController.java#readImportPreview`, `src/main/java/org/courtside/dataexchange/web/ImportPreviewAdminController.java#toResponse`.

Positive tests: `src/test/java/org/courtside/dataexchange/web/ImportPreviewAdminControllerTest.java#givenAFileOfPeopleThisSourceHasNotSeen_whenPreviewing_thenEveryRowIsACreationAndNothingIsWritten`.

Negative tests: `src/test/java/org/courtside/dataexchange/PreviewRetentionTest.java#givenAPreviewPastItsRetention_whenReadingIt_thenTheCountsRemainAndTheChangeSetIsGone`.

### Public response projection

Public configuration and calendar responses use dedicated DTO projections and never widen to administrative configuration, roster or another person's booking details.

Attributes: `viewer-account`, `booking-owner`, `public-schema`.

Production: `src/main/java/org/courtside/config/web/ConfigController.java#toResponse`, `src/main/java/org/courtside/booking/internal/AllocationVisibilityService.java#resolve`, `src/main/java/org/courtside/booking/internal/AllocationVisibilityService.java#participantPersonIds`, `src/main/java/org/courtside/booking/web/BookingController.java#listAllocations`, `src/main/java/org/courtside/booking/web/BookingController.java#toResponse`.

Positive tests: `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenABookingOnADay_whenRequestingThatDaysGrid_thenTheBookingIsListed`, `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenOwnBookingWithAnotherMember_whenLoadingTheGrid_thenOnlyOwnershipAndSurnameAreVisible`.

Negative tests: `src/test/java/org/courtside/config/web/ConfigControllerTest.java#whenReadingThePublicConfig_thenItPublishesNothingOnlyABoardShouldSee`, `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenAnotherMembersBooking_whenLoadingTheGrid_thenOwnershipAndParticipantsAreHidden`.

### Participant directory projection

Participant search returns only the stable person identifier and display name of current members, never roster, account, address or membership administration fields.

Attributes: `current-membership`, `permanent-account`, `participant-schema`.

Production: `src/main/java/org/courtside/member/web/ParticipantMemberController.java#searchParticipantMembers`.

Positive tests: `src/test/java/org/courtside/member/web/ParticipantMemberControllerTest.java#givenMembersAndANonMember_whenSearchingByName_thenOnlyMatchingMembersAreReturned`.

Negative tests: `src/test/java/org/courtside/member/web/ParticipantMemberControllerTest.java#givenNoSession_whenSearchingMembers_thenItIsUnauthenticated`.

### Administrative response projection

Administrative DTOs may expose the documented roster and operational fields to ADMIN only; credentials remain absent and subject access omits other people's booking data.

Attributes: `administrator`, `response-schema`, `subject-person`.

Production: `src/main/java/org/courtside/member/RosterService.java#load/1`, `src/main/java/org/courtside/member/RosterService.java#requiredLanguage/1`, `src/main/java/org/courtside/member/web/RosterAdminController.java#toResponse`, `src/main/java/org/courtside/member/internal/RosterSecurityEventLog.java#record`, `src/main/java/org/courtside/config/web/ConfigController.java#toAdminResponse`, `src/main/java/org/courtside/audit/internal/DomainEventWriter.java#actor`, `src/main/java/org/courtside/audit/web/AuditAdminController.java#toResponse`, `src/main/java/org/courtside/notification/web/MessageAdminController.java#toResponse`, `src/main/java/org/courtside/dataexchange/web/SubjectAccessAdminController.java#toResponse`, `src/main/java/org/courtside/dataexchange/web/ExternalReferenceAdminController.java#toResponse`, `src/main/java/org/courtside/dataexchange/web/ImportPreviewAdminController.java#createImportPreview`, `src/main/java/org/courtside/dataexchange/web/ImportPreviewAdminController.java#toResponse`, `src/main/java/org/courtside/dataexchange/web/ImportExecutionAdminController.java#toResponse`, `src/main/java/org/courtside/dataexchange/web/ExportAdminController.java#exportRoster`, `src/main/java/org/courtside/dataexchange/web/ExportAdminController.java#exportBookings`.

Positive tests: `src/test/java/org/courtside/dataexchange/web/SubjectAccessAdminControllerTest.java#givenAPersonTheInstanceHoldsEverythingAbout_whenABoardAsks_thenEachOfThoseThingsIsAnswered`.

Negative tests: `src/test/java/org/courtside/dataexchange/web/SubjectAccessAdminControllerTest.java#givenABookingSomebodyElseMade_whenABoardAsksAboutTheNamedMember_thenNeitherMakerNorNoteIsNamed`.

## Protected field rules

| Rule | Access | Fields | Operations | Actors and attributes |
|---|---|---|---|---|
| `login-credentials-write-only` | never-read | `$request.username`, `$request.password` | `logIn` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `dedicated-workflow`, `request-field` |
| `session-identity-read` | read | `SessionStatus.username`, `SessionStatus.displayName`, `SessionStatus.locale`, `SessionStatus.roles`, `SessionStatus.passwordChangeRequired` | `getSessionStatus` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `current-session` |
| `own-session-metadata-read` | read | `AccountSession.handle`, `AccountSession.createdAt`, `AccountSession.lastActivityAt`, `AccountSession.current`, `AccountSession.browserFamily` | `listOwnSessions` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account` |
| `initial-credential-input-write-only` | never-read | `InitialPasswordChangeRequest.password` | `changeInitialPassword` | `INITIAL_PASSWORD`; `dedicated-workflow` |
| `permanent-password-change-write-only` | never-read | `PasswordChangeRequest.currentPassword`, `PasswordChangeRequest.newPassword` | `changeOwnPassword` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `dedicated-workflow`, `current-account` |
| `reauthentication-password-write-only` | never-read | `ReauthenticationRequest.password` | `reauthenticate` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `dedicated-workflow`, `current-account` |
| `participant-member-read` | read | `PublicParticipantMember.personId`, `PublicParticipantMember.displayName` | `searchParticipantMembers` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-membership` |
| `public-allocation-read` | read | `Allocation.ownBooking`, `Allocation.participantLastNames`, `Allocation.bookedByName` | `listAllocations` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `viewer-account`, `booking-owner` |
| `personal-booking-read` | read | `PersonalBooking.id`, `PersonalBooking.seriesId`, `PersonalBooking.note` | `listPersonalBookings` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `booking-owner`, `current-account` |
| `managed-booking-detail-read` | read | `ManagedAppointmentDetail.note`, `ManagedAppointmentDetail.participants`, `ManagedParticipant.displayName` | `getManagedAppointment` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `booking-card`, `managing-role`, `administrator-override` |
| `roster-person-create` | write | `PersonRequest.firstName`, `PersonRequest.lastName`, `PersonRequest.email` | `createPerson` | `ADMIN`; `administrator` |
| `roster-person-correction` | write | `PersonRequest.firstName`, `PersonRequest.lastName`, `PersonRequest.email` | `changePerson` | `ADMIN`; `administrator`, `recent-authentication` |
| `account-create-write` | write | `AccountRequest.username`, `AccountRequest.roles` | `createAccount` | `ADMIN`; `administrator`, `recent-authentication` |
| `account-username-write` | write | `UsernameRequest.username` | `changeAccountUsername` | `ADMIN`; `administrator`, `recent-authentication` |
| `account-role-write` | write | `RolesRequest.roles` | `changeAccountRoles` | `ADMIN`; `administrator`, `recent-authentication`, `enabled-administrator-count` |
| `account-enabled-write` | write | `ActiveRequest.active` | `setAccountActive` | `ADMIN`; `administrator`, `recent-authentication`, `enabled-administrator-count` |
| `roster-and-account-read` | read | `RosterEntry.personId`, `RosterEntry.firstName`, `RosterEntry.lastName`, `RosterEntry.email`, `RosterEntry.accountId`, `RosterEntry.username`, `RosterEntry.locale`, `RosterEntry.addressSharedBy`, `RosterEntry.credentialState`, `RosterEntry.enabled`, `RosterEntry.membershipTypeId`, `RosterEntry.membershipStartedOn`, `RosterEntry.membershipEndedOn`, `RosterEntry.roles` | `searchRoster`, `createPerson`, `readPerson`, `changePerson`, `createAccount`, `changeAccountRoles`, `changeAccountUsername`, `changeAccountLocale`, `requestAccountCredentials`, `setAccountActive`, `assignMembership` | `ADMIN`; `administrator`, `target-person` |
| `administrative-config-read-write` | read | `AdminClubConfig.newAccountCredentialHours`, `AdminClubConfig.passwordResetCredentialHours`, `AdminClubConfig.bookingReminderHours`, `AdminClubConfig.noMembershipTypeRuleSetId` | `getClubConfigForAdmin`, `changeClubConfig`, `uploadClubLogo`, `deleteClubLogo` | `ADMIN`; `administrator` |
| `administrative-config-write` | write | `ClubConfigRequest.newAccountCredentialHours`, `ClubConfigRequest.passwordResetCredentialHours`, `ClubConfigRequest.bookingReminderHours`, `ClubConfigRequest.noMembershipTypeRuleSetId` | `changeClubConfig` | `ADMIN`; `administrator` |
| `booking-party-write` | write | `ParticipantRequest.personId`, `ParticipantRequest.guestName`, `ParticipantRequest.cardId`, `CreateBookingRequest.note`, `CreateBookingRequest.participants` | `createBooking` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `booking-card`, `allowed-role`, `current-membership` |
| `booking-series-note-write` | write | `SeriesRuleRequest.note` | `previewSeries`, `createSeries` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `booking-card`, `allowed-role` |
| `audit-record-read` | read | `AuditEntry.parameters`, `AuditEntry.subjectId`, `AuditEntry.subjectName`, `AuditEntry.actorAccountId`, `AuditEntry.actorUsername` | `readAuditLog` | `ADMIN`; `administrator` |
| `message-record-read` | read | `MessageEntry.messageId`, `MessageEntry.personId`, `MessageEntry.personName` | `readMessageLog` | `ADMIN`; `administrator` |
| `subject-access-read` | read | `SubjectAccessExport.personId`, `SubjectAccessExport.firstName`, `SubjectAccessExport.lastName`, `SubjectAccessExport.email`, `SubjectAccessExport.accounts`, `SubjectAccessExport.memberships`, `SubjectAccessExport.bookingsMade`, `SubjectAccessExport.bookingsRecordedIn`, `SubjectAccessExport.externalReferences`, `SubjectAccessExport.changesAsSubject`, `SubjectAccessExport.changesAsActor` | `exportPersonData` | `ADMIN`; `administrator`, `subject-person` |
| `external-reference-person-data-read` | read | `ExternalReference.externalId`, `ExternalReference.personId`, `ExternalReference.personName` | `listExternalReferences`, `linkExternalReference` | `ADMIN`; `administrator` |
| `import-preview-person-data-read` | read | `ImportPersonChange.externalId`, `ImportPersonChange.personId`, `ImportPersonChange.personName`, `ImportPersonChange.values`, `ImportPossibleDuplicate.externalId`, `ImportPossibleDuplicate.personId`, `ImportPossibleDuplicate.personName`, `ImportSharedAddress.externalId` | `createImportPreview`, `readImportPreview` | `ADMIN`; `administrator`, `preview-expiry` |

Every field not declared by an operation's OpenAPI request schema is rejected before the operation runs. Every field not declared by its response schema is outside that operation's projection. The rules above name the fields whose visibility or mutability is narrower than merely satisfying that schema.
