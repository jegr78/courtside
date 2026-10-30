# Authorization policy

> Generated from `security/authorization-policy.json`; edit the maintained policy, not this file.

This is the normative authorization policy for the shipped Courtside API. OpenAPI defines the transport shape; this policy defines who may perform each operation, which resource attributes narrow that permission, and which protected fields each projection may read or write.

The maintained JSON classifies every reachable OpenAPI field either as ordinary or under one of the protected-field rules below. Ordinary fields inherit their operation rule without an additional ownership or workflow restriction. Fingerprints bind that classification and the named production authorization methods to the reviewed code.

## Principals

| Principal | Meaning |
|---|---|
| `ANONYMOUS` | A caller without an authenticated Courtside session. |
| `MEMBER` | An authenticated account holding the ordinary member role. |
| `TRAINER` | An authenticated account holding the trainer role. The start-up warm-up passes this role without an account to preview a series. |
| `SPORT_DIRECTOR` | An authenticated account holding the sport-director role. |
| `YOUTH_DIRECTOR` | An authenticated account holding the youth-director role. |
| `GROUNDSKEEPER` | An authenticated account holding the groundskeeper role. |
| `TREASURER` | An authenticated account holding the treasurer role. |
| `ADMIN` | An authenticated account holding the instance administrator role. The start-up warm-up passes this role without an account to write a booking it rolls back. |
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
| `booking-card-generic-occupancy` | Whether the booking card must hide its identity from viewers other than the booking owner. |
| `booking-owner` | Whether the current account created the selected booking. |
| `current-account` | The account derived from the authenticated session rather than request input. |
| `current-membership` | Whether a referenced person holds a membership that has not ended. |
| `current-session` | Whether a session record is the browser session making the request. |
| `dedicated-workflow` | Whether a protected value enters through the one operation intended to handle it. |
| `enabled-administrator-count` | The number of other enabled accounts that retain ADMIN authority. |
| `five-minute-window` | Whether the latest full password proof is no older than five minutes. |
| `guardian-relationship` | Whether a relationship holding on the club's today lets the authenticated account act for the named dependant, and which actions it grants. |
| `managing-role` | Whether a current account role occurs in the booking card manager list. |
| `occurrence-scope` | The whole-series, following-occurrences or single-occurrence scope requested. |
| `participant-card-active` | Whether a participant card remains active and may be offered for a new booking. |
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
| `waitlist-entry-owner` | The account that joined a waitlist entry. |
| `mfa-pending-session` | A password-verified pending browser session has no authenticated roles or account privileges. |
| `mfa-challenge` | A server-stored ceremony binds account, browser session, purpose, security epoch, expiry and attempt count. |
| `mfa-factor-enabled` | The current account has an active TOTP or native WebAuthn method; recovery codes are single-use alternatives. |
| `mfa-recovery-pending` | A controlled rescue blocks password login, ordinary reset, issued credentials and factor changes. |
| `mfa-security-epoch` | The locked account security epoch must match the principal or saved challenge. |
| `mfa-identity-check` | An administrator explicitly confirms an identity check outside the request. |
| `mfa-guess-budget` | Persistent account and address limits survive newly requested ceremonies or rescue codes. |
| `mfa-current-address` | The rescue verifier binds the current account email address and security epoch. |

## Operation rules

| Rule | Operations | Admitted actors | Required decisions |
|---|---|---|---|
| `public-platform-and-session-boundary` | `getSourceOffer`, `getApiDocument`, `getSessionStatus`, `logOut` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD` | `request-boundary` |
| `public-login-boundary` | `logIn` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD` | `request-boundary`, `credential-write-only` |
| `public-password-recovery-boundary` | `requestPasswordReset` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD` | `request-boundary`, `credential-write-only` |
| `public-password-redemption-boundary` | `redeemPasswordReset` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD` | `request-boundary`, `credential-write-only` |
| `public-username-reminder-boundary` | `requestUsernameReminder` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD` | `request-boundary` |
| `public-club-and-calendar` | `listCourts`, `listOpeningHours`, `getBookingGrid`, `getClubConfig`, `getClubLogo`, `getAppIcon`, `getWebManifest`, `listBookingCardLegend`, `listAllocations`, `listReservedSlots` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD` | `request-boundary`, `public-projection` |
| `initial-password-replacement` | `changeInitialPassword` | `INITIAL_PASSWORD` | `initial-password-gate`, `credential-write-only` |
| `own-account-preferences-and-session-list` | `listOwnSessions`, `changeOwnLocale`, `listOwnMessageChoices`, `chooseOwnMessages`, `listOwnMessageChannels`, `chooseOwnMessageChannels`, `listOwnNotifications`, `markOwnNotificationRead` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `own-account-scope` |
| `own-credential-proof-and-replacement` | `reauthenticate`, `changeOwnPassword` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `own-account-scope`, `credential-write-only` |
| `own-session-termination` | `endOwnSessions`, `endOwnSession` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `own-account-scope`, `recent-authentication` |
| `authenticated-booking-card-discovery` | `listBookableCards` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `booking-card-eligibility` |
| `authenticated-participant-card-discovery` | `listParticipantCards` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `participant-card-availability` |
| `authenticated-member-directory` | `searchParticipantMembers` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `member-directory-projection` |
| `booking-create-and-preview` | `createBooking`, `getBookingEligibility`, `previewSeries`, `createSeries` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `booking-card-eligibility` |
| `own-booking-and-participation` | `cancelBooking`, `listPersonalBookings`, `listOwnParticipations`, `removeOwnParticipation`, `checkIn` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `booking-ownership` |
| `members-door-codes` | `listMembersDoorCodes` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `members-door-code-projection` |
| `guardian-account-tasks` | `requestDependantCredentials` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `guardian-delegation`, `recent-authentication` |
| `guardian-acting-for-dependant` | `listDependants`, `listDependantBookings`, `createDependantBooking`, `cancelDependantBooking`, `listDependantNotifications` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `guardian-delegation` |
| `own-waitlist` | `listOwnWaitlistEntries`, `joinWaitlist`, `leaveWaitlist`, `acceptWaitlistOffer` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `booking-card-eligibility`, `waitlist-ownership` |
| `partner-search` | `publishPartnerInvitation`, `withdrawPartnerInvitation`, `listOpenPlaces`, `acceptPartnerInvitation` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `booking-card-eligibility`, `partner-invitation-ownership` |
| `managed-booking` | `listManagedAppointments`, `getManagedAppointment` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `managed-booking-scope` |
| `owned-series` | `cancelSeries`, `previewSeriesMove`, `moveSeries` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `series-ownership` |
| `administration` | `listCourtsForAdmin`, `createCourt`, `getCourt`, `changeCourt`, `setCourtActive`, `listAccessPoints`, `createAccessPoint`, `getAccessPoint`, `changeAccessPoint`, `setAccessPointActive`, `listAccessGrants`, `probeAccessControl`, `retryAccessGrant`, `listBookingCards`, `createBookingCard`, `getBookingCard`, `changeBookingCard`, `setBookingCardActive`, `listParticipantCardsForAdmin`, `createParticipantCard`, `getParticipantCard`, `changeParticipantCard`, `setParticipantCardActive`, `listMembershipTypes`, `createMembershipType`, `getMembershipType`, `changeMembershipType`, `setMembershipTypeActive`, `searchRoster`, `createPerson`, `readPerson`, `changeAccountLocale`, `assignMembership`, `removeMembership`, `listSupportedEncodings`, `listImportSources`, `createImportSource`, `readImportSource`, `changeImportSource`, `deleteImportSource`, `listExternalReferences`, `linkExternalReference`, `unlinkExternalReference`, `createImportPreview`, `readImportPreview`, `listImportRuns`, `listRuleSets`, `createRuleSet`, `listRuleTypes`, `getRuleSet`, `changeRuleSet`, `setRuleSetActive`, `listOpeningHoursForAdmin`, `setWeeklyOpeningHours`, `listOpeningScheduleForAdmin`, `removeScheduledOpeningHours`, `listOpeningPeriods`, `createOpeningPeriod`, `changeOpeningPeriod`, `removeOpeningPeriod`, `listCourtClosures`, `createCourtClosure`, `changeCourtClosure`, `removeCourtClosure`, `getClubConfigForAdmin`, `changeClubConfig`, `uploadClubLogo`, `deleteClubLogo`, `listRules`, `setRule`, `removeRule`, `courtImpact`, `bookingCardImpact`, `openingHoursImpact`, `openingPeriodImpact`, `courtClosureImpact`, `facilityUtilisation`, `usageReport`, `readStatisticsRange`, `readUtilisationStatistics`, `readBookingStatistics`, `readMemberStatistics`, `readMessageStatistics`, `readMessageLog`, `listMessageTemplates`, `previewMessageTemplate`, `readAuditLog`, `searchAuditLog`, `searchOperationalLogs`, `exportRoster`, `exportBookings`, `exportAuditLog`, `exportMessageLog`, `exportPersonData`, `listRetentionPolicies`, `setRetentionPolicy`, `removeRetentionPolicy`, `previewRetention`, `getAttendancePolicy`, `changeAttendancePolicy`, `recordAttendance`, `clearAttendance`, `listNoShows`, `liftNoShows`, `readOperatorHealth`, `listMembershipPeriods`, `addMembershipPeriod`, `correctMembershipPeriod`, `removeMembershipPeriod`, `listGuardianRelationships` | `ADMIN` | `administrator-gate`, `administrative-projection` |
| `recent-person-administration` | `changePerson` | `ADMIN` | `administrator-gate`, `recent-authentication`, `administrative-projection` |
| `recent-account-administration` | `createAccount`, `changeAccountUsername`, `requestAccountCredentials`, `endAccountSessions`, `createGuardianRelationship`, `changeGuardianRelationship`, `endGuardianRelationship`, `removeGuardianRelationship` | `ADMIN` | `administrator-gate`, `recent-authentication`, `administrative-projection` |
| `continuity-protected-account-administration` | `changeAccountRoles`, `setAccountActive` | `ADMIN` | `administrator-gate`, `recent-authentication`, `administrator-continuity`, `administrative-projection` |
| `global-session-termination` | `endAllSessions` | `ADMIN` | `administrator-gate`, `recent-authentication` |
| `import-execution` | `executeImportPreview` | `ADMIN` | `administrator-gate`, `recent-authentication`, `import-preview-owner`, `administrative-projection` |
| `retention-run` | `runRetention` | `ADMIN` | `administrator-gate`, `recent-authentication`, `retention-preview-owner`, `administrative-projection` |
| `message-wording` | `changeMessageTemplate`, `resetMessageTemplate` | `ADMIN` | `administrator-gate`, `recent-authentication`, `administrative-projection` |
| `pending-mfa-login` | `completeMfaLogin`, `beginWebauthnLogin`, `completeWebauthnLogin` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD` | `request-boundary`, `mfa-pending-login`, `mfa-factor-proof` |
| `own-mfa-status` | `getOwnMfaStatus` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `mfa-holder` |
| `own-mfa-change` | `beginTotpEnrollment`, `confirmTotpEnrollment`, `replaceOwnRecoveryCodes`, `removeOwnTotp`, `disableOwnMfa`, `beginWebauthnEnrollment`, `confirmWebauthnEnrollment`, `removeOwnWebauthnCredential`, `renameOwnWebauthnCredential` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `mfa-holder`, `recent-authentication`, `mfa-factor-proof` |
| `own-webauthn-proof-options` | `beginWebauthnReauthentication` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `mfa-holder`, `mfa-factor-proof` |
| `administrative-mfa-status` | `getAdministrativeMfaStatus` | `ADMIN` | `administrator-gate`, `mfa-admin-projection` |
| `administrative-mfa-rescue` | `initiateMfaRecovery` | `ADMIN` | `administrator-gate`, `recent-authentication`, `mfa-controlled-rescue` |
| `public-mfa-rescue-redemption` | `redeemMfaRecovery` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD` | `request-boundary`, `credential-write-only`, `mfa-controlled-rescue` |
| `booking-emergency-code` | `requestEmergencyCode`, `requestParticipationEmergencyCode` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN` | `permanent-account-gate`, `emergency-code-participation` |

## Authorization decisions

### Public request boundary

Only explicitly public routes admit an anonymous caller; all other shipped operations require a valid server-side session. MFA login routes still require the password-verified pending ceremony, and controlled recovery still requires its valid mailed code.

Attributes: `route`, `authenticated-session`, `account-enabled`, `password-change-required`.

Production: `src/main/java/org/courtside/identity/internal/SecurityConfiguration.java#filterChain`, `src/main/java/org/courtside/identity/internal/LoginAttemptFilter.java#doFilterInternal`, `src/main/java/org/courtside/identity/internal/SessionStatusController.java#getSessionStatus`.

Positive tests: `src/test/java/org/courtside/identity/AdminSurfaceTest.java#givenAnAnonymousCaller_whenCallingEveryAnonymousAllowedEndpoint_thenEveryOneOfThemPassesAuthorization`.

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

Production: `src/main/java/org/courtside/identity/internal/SecurityConfiguration.java#filterChain`, `src/main/java/org/courtside/booking/web/AttendanceAdminController.java#recordAttendance`, `src/main/java/org/courtside/booking/web/AttendanceAdminController.java#liftNoShows`, `src/main/java/org/courtside/dataexchange/web/RetentionAdminController.java#previewRetention`.

Positive tests: `src/test/java/org/courtside/identity/AdminAuthorizationTest.java#givenAnAdmin_whenCallingAnAdminEndpoint_thenItIsServed`.

Negative tests: `src/test/java/org/courtside/identity/AdminAuthorizationTest.java#givenEveryProductRole_whenCallingAnAdminEndpoint_thenOnlyAdminIsServed`.

### Own account scope

The authenticated account identifier selects profile identity, session, locale, appointment reach, message-choice, channel-choice and notification state; callers cannot supply another account identifier to these operations, and a notification id outside the account answers as not found. MFA state follows immutable principal identity rather than a reused username.

Attributes: `current-account`, `session-handle`.

Production: `src/main/java/org/courtside/identity/CurrentUser.java#requireAccount`, `src/main/java/org/courtside/identity/internal/AccountSessionService.java#list`, `src/main/java/org/courtside/identity/internal/AccountSessionService.java#endOne`, `src/main/java/org/courtside/identity/internal/AccountSessionService.java#endAll`, `src/main/java/org/courtside/identity/internal/AccountLocaleService.java#change`, `src/main/java/org/courtside/notification/internal/OwnMessageChoices.java#current`, `src/main/java/org/courtside/notification/internal/OwnMessageChoices.java#choose`, `src/main/java/org/courtside/notification/internal/OwnMessageChoices.java#currentChannels`, `src/main/java/org/courtside/notification/internal/OwnMessageChoices.java#chooseChannels`, `src/main/java/org/courtside/notification/internal/OwnMessageChoices.java#accountId`, `src/main/java/org/courtside/notification/internal/OwnNotifications.java#page`, `src/main/java/org/courtside/notification/internal/OwnNotifications.java#markRead`, `src/main/java/org/courtside/notification/internal/OwnNotifications.java#accountId`, `src/main/java/org/courtside/card/internal/CardAppointmentAccess.java#reachOf`.

Positive tests: `src/test/java/org/courtside/identity/AccountSessionLifecycleTest.java#givenTwoActiveSessions_whenOneIsListedAndEnded_thenOnlyPrivacySafeMetadataAndTheOtherRemain`, `src/test/java/org/courtside/notification/web/NotificationControllerTest.java#givenNotificationsForTwoMembers_whenOneReadsTheCentre_thenOnlyTheirOwnAreServedWithContentAndLink`, `src/test/java/org/courtside/identity/SessionAppointmentAccessTest.java#givenACardNamingTheTreasurerOnlyAsManagingRole_whenItReadsTheSession_thenItManagesButCreatesNoSeries`, `src/test/java/org/courtside/identity/SessionProfileTest.java#givenAnAccountWithAssignedRoles_whenReadingItsSession_thenItsOwnNamePartsAndExactRolesAreReturned`.

Negative tests: `src/test/java/org/courtside/identity/internal/AccountSessionServiceTest.java#givenAnUnknownHandle_whenASessionIsEnded_thenNothingIsDeleted`, `src/test/java/org/courtside/notification/web/NotificationControllerTest.java#givenAnotherMembersNotification_whenAMemberMarksItRead_thenItIsNotFoundAndStaysUnread`, `src/test/java/org/courtside/identity/SessionAppointmentAccessTest.java#givenNoActiveCardNamingTheTreasurer_whenItReadsTheSession_thenItNeitherManagesNorCreatesSeries`, `src/test/java/org/courtside/identity/SessionProfileTest.java#givenNoAccountSession_whenReadingTheSession_thenNoIdentityValuesAreExposed`, `src/test/java/org/courtside/identity/SessionProfileTest.java#givenARevokedAccountSession_whenReadingTheSession_thenThePreviousIdentityIsAbsent`.

### Credential write-only boundary

Passwords are accepted only by their dedicated credential workflows, never returned in a response and never accepted by account administration.

Attributes: `dedicated-workflow`, `request-field`.

Production: `src/main/java/org/courtside/identity/internal/AccountController.java#changeInitialPassword`, `src/main/java/org/courtside/identity/internal/AccountController.java#changeOwnPassword`, `src/main/java/org/courtside/identity/internal/AccountRecoveryService.java#mailAResetCode`, `src/main/java/org/courtside/identity/internal/PermanentPasswordService.java#change`, `src/main/java/org/courtside/identity/internal/ReauthenticationService.java#reauthenticate`, `src/main/java/org/courtside/identity/internal/SecurityConfiguration.java#loginEndpoint`, `src/main/java/org/courtside/member/web/RosterAdminController.java#createAccount`.

Positive tests: `src/test/java/org/courtside/identity/PermanentPasswordChangeTest.java#givenTwoActiveSessions_whenThePasswordIsReplaced_thenBothEndAndOnlyTheReplacementSignsIn`.

Negative tests: `src/test/java/org/courtside/member/web/RosterAdminControllerTest.java#givenARequestStillCarryingAPassword_whenCreatingAnAccount_thenTheContractRefusesIt`.

### Booking card role and state

A booking card must be active and admit at least one actor role; ADMIN bypasses the card role list but not facility availability or invariant checks. The start-up warm-up also acts here as an in-process caller without an account or request input, and it rolls back every write it makes.

Attributes: `booking-card`, `booking-card-active`, `allowed-role`, `administrator-override`.

Production: `src/main/java/org/courtside/booking/internal/CardEligibilityPolicy.java#requireEligible`, `src/main/java/org/courtside/booking/internal/BookingRuleGate.java#bookingEligibilityFor`, `src/main/java/org/courtside/booking/internal/BookingRuleGate.java#bookingWindowFor`, `src/main/java/org/courtside/booking/internal/BookingRuleGate.java#maxBookingMinutesFor`, `src/main/java/org/courtside/booking/internal/BookingRuleGate.java#maxWeeklyBookedHoursFor`, `src/main/java/org/courtside/booking/internal/BookingRuleGate.java#minBookingMinutesFor`, `src/main/java/org/courtside/booking/internal/BookingRuleGate.java#requireCancellationAllowed`, `src/main/java/org/courtside/booking/internal/BookingRuleGate.java#restrictionsApplyTo`, `src/main/java/org/courtside/booking/BookingWriter.java#write/3`, `src/main/java/org/courtside/card/CardService.java#bookableCards`, `src/main/java/org/courtside/card/web/CardController.java#callerRoles`, `src/main/java/org/courtside/booking/series/SeriesService.java#create`, `src/main/java/org/courtside/booking/web/BookingController.java#getBookingEligibility`, `src/main/java/org/courtside/booking/web/BookingController.java#createBooking`, `src/main/java/org/courtside/booking/web/SeriesController.java#createSeries`, `src/main/java/org/courtside/booking/web/SeriesController.java#previewSeries`, `src/main/java/org/courtside/booking/internal/BookingWriteWarmUp.java#run`, `src/main/java/org/courtside/booking/internal/SeriesPreviewWarmUp.java#run`, `src/main/java/org/courtside/booking/waitlist/WaitlistService.java#join`, `src/main/java/org/courtside/booking/BookingWriter.java#bookable`, `src/main/java/org/courtside/booking/waitlist/WaitlistQueue.java#eligible`, `src/main/java/org/courtside/booking/internal/CardEligibilityPolicy.java#admits`, `src/main/java/org/courtside/booking/BookingWriter.java#isBookable`, `src/main/java/org/courtside/booking/partner/PartnerSearchService.java#mayTakeAPlace`, `src/main/java/org/courtside/booking/partner/PartnerSearchService.java#openPlaces`, `src/main/java/org/courtside/booking/partner/PartnerSearchService.java#accept`.

Positive tests: `src/test/java/org/courtside/booking/internal/CardEligibilityPolicyTest.java#givenTheRequiredRole_whenRequiringEligibility_thenTheCardIsReturned`.

Negative tests: `src/test/java/org/courtside/booking/internal/CardEligibilityPolicyTest.java#givenOnlyAnotherRole_whenRequiringEligibility_thenTheRoleFailureIsRaised`.

### Booking and participation ownership

Personal queries derive identity from the current account; cancellation requires the booking owner or ADMIN, check-in requires the booking owner and withdrawal removes only the current person's participation, from a booking that is not cancelled; a person the booking never named is answered as not found before its status is read. A notification describes and links a booking only to its owner or a current participant. The start-up warm-up also acts here as an in-process caller without an account or request input, and it rolls back every write it makes.

Attributes: `current-account`, `booking-owner`, `participant-person`, `administrator-override`.

Production: `src/main/java/org/courtside/booking/BookingService.java#cancel/4`, `src/main/java/org/courtside/booking/BookingWriter.java#cancel`, `src/main/java/org/courtside/booking/BookingWriter.java#cancelBooking`, `src/main/java/org/courtside/booking/Booking.java#withdrawParticipant`, `src/main/java/org/courtside/booking/internal/BookingAccessControl.java#requireManagementAccess`, `src/main/java/org/courtside/booking/internal/BookingAccessControl.java#requireRoleManagementAccess`, `src/main/java/org/courtside/card/BookingCard.java#managementRoles`, `src/main/java/org/courtside/booking/ParticipationService.java#withdraw`, `src/main/java/org/courtside/booking/internal/BookingAnnouncements.java#describeVisibleTo`, `src/main/java/org/courtside/booking/internal/BookingAnnouncements.java#visibleTo`, `src/main/java/org/courtside/booking/web/BookingController.java#listPersonalBookings`, `src/main/java/org/courtside/booking/web/BookingController.java#listOwnParticipations`, `src/main/java/org/courtside/booking/web/BookingController.java#removeOwnParticipation`, `src/main/java/org/courtside/booking/web/BookingController.java#cancelBooking`, `src/main/java/org/courtside/booking/internal/BookingWriteWarmUp.java#run`, `src/main/java/org/courtside/booking/attendance/AttendanceService.java#checkIn`, `src/main/java/org/courtside/booking/web/CheckInController.java#checkIn`.

Positive tests: `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenAnOwnBooking_whenCancellingIt_thenItDisappearsFromTheGrid`, `src/test/java/org/courtside/notification/web/NotificationControllerTest.java#givenAPlayerStillInABooking_whenTheyReadTheCentre_thenTheEntryDescribesAndLinksTheBooking`, `src/test/java/org/courtside/booking/web/AttendanceControllerTest.java#givenTheCheckInWindowIsOpen_whenTheMemberChecksIn_thenTheirBookingShowsItAsCheckedIn`.

Negative tests: `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenAForeignBooking_whenAMemberCancelsIt_thenItIsNotFoundAndItStaysConfirmed`, `src/test/java/org/courtside/notification/web/NotificationControllerTest.java#givenAPlayerWhoLeftTheBooking_whenTheyReadTheCentre_thenTheEntryNoLongerDescribesOrLinksIt`, `src/test/java/org/courtside/booking/attendance/AttendanceTest.java#givenSomebodyElsesBooking_whenAMemberChecksIn_thenItIsAnsweredLikeABookingThatDoesNotExist`, `src/test/java/org/courtside/booking/ParticipationServiceTest.java#givenACancelledBooking_whenSomebodyItNeverNamedWithdraws_thenItIsNotFoundRatherThanCancelled`, `src/test/java/org/courtside/booking/ParticipationWithdrawalConcurrencyTest.java#givenACancellationHoldingTheBooking_whenTheCoPlayerWithdraws_thenTheWithdrawalWaitsAndIsRefused`.

### Guardian delegation

Every guardian action reads, at its point of use, the relationship between the authenticated account's person and the named dependant on the club's today. Without one holding, or while the guardian's account is disabled or the dependant holds no account, the dependant answers as not found; an action the relationship does not grant is refused by name. A booking is held by the dependant's account and measured against the dependant and the dependant's roles without the administrator override; cancellation reaches only a booking the dependant holds, in the dependant's name. Reading messages marks nothing read.

Attributes: `current-account`, `guardian-relationship`, `booking-owner`, `account-enabled`.

Production: `src/main/java/org/courtside/member/GuardianDelegation.java#require`, `src/main/java/org/courtside/member/GuardianDelegation.java#requireBookable`, `src/main/java/org/courtside/member/GuardianDelegation.java#requireReadableAccount`, `src/main/java/org/courtside/member/GuardianRelationships.java#grantsFor`, `src/main/java/org/courtside/member/GuardianRelationships.java#runningFor`, `src/main/java/org/courtside/member/DependantService.java#dependantsOfCurrentAccount`, `src/main/java/org/courtside/member/DependantService.java#requestCredentials`, `src/main/java/org/courtside/booking/DependantBookings.java#bookingsOf`, `src/main/java/org/courtside/booking/DependantBookings.java#bookFor`, `src/main/java/org/courtside/booking/DependantBookings.java#cancelFor`, `src/main/java/org/courtside/notification/internal/OwnNotifications.java#dependantPage`, `src/main/java/org/courtside/member/GuardianDelegation.java#dependantRoles`, `src/main/java/org/courtside/shared/web/DomainFailureHandler.java#handleDomainFailure`, `src/main/java/org/courtside/member/internal/DependantNotFoundException.java#refusesAuthorization`, `src/main/java/org/courtside/member/internal/GuardianActionNotGrantedException.java#refusesAuthorization`, `src/main/java/org/courtside/booking/internal/DependantBookingNotHeldException.java#refusesAuthorization`.

Positive tests: `src/test/java/org/courtside/booking/web/DependantBookingControllerTest.java#givenAGuardianGrantedToBook_whenBookingForTheDependant_thenTheDependantHoldsItAndTheGuardianActed`, `src/test/java/org/courtside/booking/web/DependantBookingControllerTest.java#givenAGuardianGrantedToCancel_whenCancellingTheDependantsBooking_thenItIsCancelledInTheDependantsName`, `src/test/java/org/courtside/notification/web/DependantNotificationControllerTest.java#givenAGuardianGrantedToReadMessages_whenReadingTheDependantsCentre_thenItIsTheirsAndStaysUnread`, `src/test/java/org/courtside/member/web/DependantControllerTest.java#givenAGuardianGrantedAccountTasks_whenAskingForTheDependantsCredentials_thenTheyAreIssuedOnTheGuardiansWord`.

Negative tests: `src/test/java/org/courtside/booking/web/DependantBookingControllerTest.java#givenARelationshipThatDoesNotGrantBooking_whenTheGuardianBooks_thenTheActionIsRefusedByName`, `src/test/java/org/courtside/booking/web/DependantBookingControllerTest.java#givenNoRelationshipHoldingToday_whenSomebodyActsForThePerson_thenThePersonIsNoDependantOfTheirs`, `src/test/java/org/courtside/booking/web/DependantBookingControllerTest.java#givenAnAdministratorGuardian_whenBookingForADependantBarredFromCourts_thenTheDependantsRulesRefuseIt`, `src/test/java/org/courtside/booking/web/DependantBookingControllerTest.java#givenADependantWhoManagesTrainings_whenTheGuardianCancelsSomebodyElsesTraining_thenTheRoleLendsNothing`, `src/test/java/org/courtside/notification/web/DependantNotificationControllerTest.java#givenARelationshipThatDoesNotGrantReading_whenTheGuardianReads_thenTheActionIsRefusedByName`, `src/test/java/org/courtside/member/web/DependantControllerTest.java#givenARelationshipWithoutAccountTasks_whenTheGuardianAsksForCredentials_thenNothingIsIssued`.

### Waitlist entry ownership

The current account selects which waitlist entries are read, left and accepted; another account's entry answers as not found, no response names another waiting account or a position, and a reserved court refuses every other account's booking unless an admin books it or it is closed, which withdraws the offer.

Attributes: `current-account`, `waitlist-entry-owner`.

Production: `src/main/java/org/courtside/booking/waitlist/WaitlistService.java#join`, `src/main/java/org/courtside/booking/waitlist/WaitlistService.java#leave`, `src/main/java/org/courtside/booking/waitlist/WaitlistService.java#accept`, `src/main/java/org/courtside/booking/waitlist/WaitlistService.java#ownEntries`, `src/main/java/org/courtside/booking/waitlist/WaitlistRows.java#lockOwn`, `src/main/java/org/courtside/booking/waitlist/WaitlistQueue.java#requireUnreserved`, `src/main/java/org/courtside/booking/web/WaitlistController.java#listOwnWaitlistEntries`, `src/main/java/org/courtside/booking/web/WaitlistController.java#joinWaitlist`, `src/main/java/org/courtside/booking/web/WaitlistController.java#leaveWaitlist`, `src/main/java/org/courtside/booking/web/WaitlistController.java#acceptWaitlistOffer`, `src/main/java/org/courtside/booking/internal/CourtReservations.java#blocks`, `src/main/java/org/courtside/booking/internal/CourtReservations.java#overriddenBy`.

Positive tests: `src/test/java/org/courtside/booking/web/WaitlistControllerTest.java#givenATakenCourt_whenAMemberJoinsItsWaitlist_thenTheEntryIsTheirsAndNamesNoPosition`, `src/test/java/org/courtside/booking/web/WaitlistControllerTest.java#givenAnOffer_whenTheMemberAcceptsIt_thenTheCourtIsTheirBooking`, `src/test/java/org/courtside/booking/web/WaitlistControllerTest.java#givenAWaitingEntry_whenTheMemberLeavesIt_thenItIsClosed`, `src/test/java/org/courtside/booking/waitlist/WaitlistTest.java#givenAnOffer_whenTheBoardBooksTheReservedCourt_thenTheClubTakesItAndTheOfferIsWithdrawn`.

Negative tests: `src/test/java/org/courtside/booking/web/WaitlistControllerTest.java#givenAnotherMembersOffer_whenAMemberAcceptsIt_thenItIsNotFoundAndNothingIsBooked`, `src/test/java/org/courtside/booking/web/WaitlistControllerTest.java#givenAnotherMembersEntry_whenAMemberLeavesIt_thenItIsNotFoundAndKeepsWaiting`, `src/test/java/org/courtside/booking/web/WaitlistControllerTest.java#givenAnOffer_whenAnotherMemberBooksTheCourt_thenItIsReservedForTheWaitingMember`, `src/test/java/org/courtside/booking/waitlist/WaitlistTest.java#givenAnOffer_whenATrainerMovesASeriesOntoTheReservedCourt_thenTheMoveIsBlocked`.

### Partner invitation holder and taker

Only the account holding a booking publishes or withdraws its open place; another account's booking answers as not found. Open places are listed to and taken by an enabled account acting as its own person, not barred from booking, whose roles the card admits, that neither holds the booking nor already plays in it, checked again under the booking row lock; any other invitation answers as not found, and no listed place names a person or a booking.

Attributes: `current-account`, `booking-owner`, `booking-card`, `allowed-role`.

Production: `src/main/java/org/courtside/booking/partner/PartnerSearchService.java#publish`, `src/main/java/org/courtside/booking/partner/PartnerSearchService.java#withdraw`, `src/main/java/org/courtside/booking/partner/PartnerSearchService.java#lockedOwn`, `src/main/java/org/courtside/booking/partner/PartnerSearchService.java#openPlaces`, `src/main/java/org/courtside/booking/partner/PartnerSearchService.java#accept`, `src/main/java/org/courtside/booking/partner/PartnerSearchService.java#mayTakeAPlace`, `src/main/java/org/courtside/booking/partner/PartnerInvitationRows.java#offeredBeyond`, `src/main/java/org/courtside/booking/web/PartnerSearchController.java#publishPartnerInvitation`, `src/main/java/org/courtside/booking/web/PartnerSearchController.java#withdrawPartnerInvitation`, `src/main/java/org/courtside/booking/web/PartnerSearchController.java#listOpenPlaces`, `src/main/java/org/courtside/booking/web/PartnerSearchController.java#acceptPartnerInvitation`.

Positive tests: `src/test/java/org/courtside/booking/web/PartnerSearchControllerTest.java#givenABookingLookingForAPartner_whenItsHolderOffersThePlace_thenTheirBookingSaysSo`, `src/test/java/org/courtside/booking/web/PartnerSearchControllerTest.java#givenAnOfferedPlace_whenAMemberListsOpenPlaces_thenTheEntryNamesNoPersonAndNoBooking`, `src/test/java/org/courtside/booking/web/PartnerSearchControllerTest.java#givenAnOfferedPlace_whenAMemberTakesIt_thenTheyPlayAndTheListIsEmpty`, `src/test/java/org/courtside/booking/partner/PartnerSearchTest.java#givenAPublishedPlace_whenTheHolderWithdrawsIt_thenNobodySeesOrTakesIt`.

Negative tests: `src/test/java/org/courtside/booking/web/PartnerSearchControllerTest.java#givenSomebodyElsesBooking_whenAMemberOffersOrWithdrawsItsPlace_thenTheBookingIsNotFound`, `src/test/java/org/courtside/booking/partner/PartnerSearchTest.java#givenSomebodyElsesBooking_whenAMemberPublishesOrWithdrawsIt_thenTheBookingIsNotFound`, `src/test/java/org/courtside/booking/partner/PartnerSearchTest.java#givenACardTheAccountMayNotBook_whenItsPlaceIsPublished_thenItNeitherSeesNorTakesIt`, `src/test/java/org/courtside/booking/partner/PartnerSearchTest.java#givenAMemberBarredFromBooking_whenAPlaceIsPublished_thenTheyNeitherSeeNorTakeIt`, `src/test/java/org/courtside/booking/partner/PartnerSearchTest.java#givenADisabledAccount_whenItTriesToTakeAPlace_thenThePlaceIsNotFound`, `src/test/java/org/courtside/booking/partner/PartnerSearchTest.java#givenAMemberAlreadyPlaying_whenAPlaceInTheSameBookingIsPublished_thenTheyAreNotOfferedIt`, `src/test/java/org/courtside/booking/web/PartnerSearchControllerTest.java#givenNoSession_whenOpenPlacesAreListed_thenTheRequestIsRefused`.

### Participant card availability

Participant-card discovery returns active cards only; it has no booking-card role allowlist or administrator override.

Attributes: `participant-card-active`.

Production: `src/main/java/org/courtside/card/CardService.java#activeParticipantCards`, `src/main/java/org/courtside/card/web/CardController.java#listParticipantCards`.

Positive tests: `src/test/java/org/courtside/card/web/CardControllerTest.java#givenAnActiveAndADeactivatedParticipantCard_whenListingPublicly_thenOnlyTheActiveOneIsPresent`.

Negative tests: `src/test/java/org/courtside/card/web/CardControllerTest.java#givenAnAnonymousCaller_whenListingParticipantCardsPublicly_thenItIsUnauthorized`.

### Managed booking scope

Managed listings and details contain only bookings whose card names one of the actor roles as a managing role; ADMIN sees every card. The start-up warm-up also acts here as an in-process caller without an account or request input, and it rolls back every write it makes.

Attributes: `booking-card`, `managing-role`, `administrator-override`.

Production: `src/main/java/org/courtside/booking/BookingRepository.java#findUpcomingManagedBookingIds`, `src/main/java/org/courtside/booking/BookingRepository.java#findManagedBookingHistoryIds`, `src/main/java/org/courtside/booking/internal/ManagedAppointmentQuery.java#list`, `src/main/java/org/courtside/booking/internal/ManagedAppointmentQuery.java#get`, `src/main/java/org/courtside/booking/web/BookingController.java#listManagedAppointments`, `src/main/java/org/courtside/booking/web/BookingController.java#getManagedAppointment`, `src/main/java/org/courtside/booking/internal/BookingWriteWarmUp.java#run`.

Positive tests: `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenAnOfficerAppointment_whenListingManagedAppointments_thenBothResponsibleRolesSeeIt`, `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenACardManagedByTrainers_whenATrainerOpensAnAppointmentOnIt_thenTheParticipantsAreShown`.

Negative tests: `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenAnOfficerAppointment_whenAnOrdinaryMemberListsManagedAppointments_thenNothingIsDisclosed`, `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenAnOfficerAppointmentInHistory_whenAnUnrelatedTrainerListsIt_thenNothingIsDisclosed`, `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenACardBookableByMembersAndTrainers_whenATrainerOpensAMemberAppointment_thenItIsRefused`.

### Series ownership and management

Moving or cancelling a series requires its creator, a role that manages the series booking card, or ADMIN; the selected occurrence scope is preserved.

Attributes: `series-owner`, `booking-card`, `managing-role`, `administrator-override`, `occurrence-scope`.

Production: `src/main/java/org/courtside/booking/series/SeriesService.java#requireManagementAccessTo`, `src/main/java/org/courtside/booking/series/SeriesService.java#previewMove/4`, `src/main/java/org/courtside/booking/web/SeriesController.java#cancelSeries`, `src/main/java/org/courtside/booking/web/SeriesController.java#moveSeries`, `src/main/java/org/courtside/booking/web/SeriesController.java#previewSeriesMove`.

Positive tests: `src/test/java/org/courtside/booking/series/SeriesMovePreviewTest.java#givenATrainingSeriesCreatedByATrainer_whenAYouthDirectorPreviewsAMove_thenItIsAllowed`.

Negative tests: `src/test/java/org/courtside/booking/series/SeriesMovePreviewTest.java#givenTheCallerDoesNotOwnTheSeriesAndIsNotAdmin_whenPreviewingAMove_thenItIsRejected`.

### Recent full authentication proof

Sensitive operations require full proof no older than five minutes. Accounts without MFA prove their password; enrolled accounts prove their password plus an unused TOTP/recovery code or valid native WebAuthn assertion. Password-only repetition cannot renew an enrolled account proof. Factor enrollment and changes use the same current-account and recent-proof gate.

Attributes: `authenticated-at`, `current-session`, `five-minute-window`.

Production: `src/main/java/org/courtside/identity/RecentAuthentication.java#requireRecent`, `src/main/java/org/courtside/identity/GlobalSessionAdministration.java#endAll`, `src/main/java/org/courtside/member/web/RosterAdminController.java#changePerson`, `src/main/java/org/courtside/member/web/RosterAdminController.java#createAccount`, `src/main/java/org/courtside/member/web/RosterAdminController.java#changeAccountRoles`, `src/main/java/org/courtside/member/web/RosterAdminController.java#changeAccountUsername`, `src/main/java/org/courtside/member/web/RosterAdminController.java#requestAccountCredentials`, `src/main/java/org/courtside/member/web/RosterAdminController.java#setAccountActive`, `src/main/java/org/courtside/member/web/RosterAdminController.java#endAccountSessions`, `src/main/java/org/courtside/member/web/RosterAdminController.java#endAllSessions`, `src/main/java/org/courtside/dataexchange/web/ImportExecutionAdminController.java#executeImportPreview`, `src/main/java/org/courtside/notification/web/MessageTemplateAdminController.java#changeMessageTemplate`, `src/main/java/org/courtside/notification/web/MessageTemplateAdminController.java#resetMessageTemplate`, `src/main/java/org/courtside/dataexchange/web/RetentionAdminController.java#runRetention`, `src/main/java/org/courtside/member/web/RosterAdminController.java#createGuardianRelationship`, `src/main/java/org/courtside/member/web/RosterAdminController.java#changeGuardianRelationship`, `src/main/java/org/courtside/member/web/RosterAdminController.java#endGuardianRelationship`, `src/main/java/org/courtside/member/web/RosterAdminController.java#removeGuardianRelationship`, `src/main/java/org/courtside/member/DependantService.java#requestCredentials`.

Positive tests: `src/test/java/org/courtside/identity/AdminRecentAuthenticationTest.java#givenAnotherAccountsSessions_whenAdminProofIsRefreshed_thenOnlyTheTargetEnds`, `src/test/java/org/courtside/dataexchange/web/RetentionAdminControllerTest.java#givenARemovableFormerMember_whenTheRunApplies_thenThePersonAndTheirAccountLeaveAndTheLogKeepsCountsOnly`, `src/test/java/org/courtside/identity/internal/MfaLoginTest.java#givenAnMfaSession_whenPasswordAndAnotherTotpStepAreRepeated_thenFreshProofRenewsTheSession`.

Negative tests: `src/test/java/org/courtside/identity/AdminRecentAuthenticationTest.java#givenNoRecentProof_whenAnAdminPerformsSensitiveChanges_thenEveryChangeIsRefused`, `src/test/java/org/courtside/dataexchange/web/RetentionAdminControllerTest.java#givenNoRecentProof_whenARunIsAsked_thenItIsRefusedAndThePreviewStillWaits`, `src/test/java/org/courtside/member/web/GuardianshipAdminControllerTest.java#givenAStaleSignIn_whenTheBoardWritesARelationship_thenEveryWriteAsksForAFreshProof`, `src/test/java/org/courtside/member/web/DependantControllerTest.java#givenAStaleSignIn_whenTheGuardianAsksForCredentials_thenAFreshProofIsRequiredAndNothingIsIssued`, `src/test/java/org/courtside/identity/internal/MfaLoginTest.java#givenAnMfaSessionWithExpiredProof_whenOnlyThePasswordIsRepeated_thenSensitiveProofIsNotRenewed`.

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

### Retention preview ownership and state

Only the administrator who created a retention preview may run it, once, before it expires and while the periods it applies are unchanged.

Attributes: `preview-reviewer`, `preview-current`, `preview-expiry`.

Production: `src/main/java/org/courtside/dataexchange/RetentionService.java#run`, `src/main/java/org/courtside/dataexchange/RetentionService.java#requireTheSamePeriods`, `src/main/java/org/courtside/dataexchange/RetentionService.java#setPolicy`, `src/main/java/org/courtside/dataexchange/RetentionService.java#removePolicy`.

Positive tests: `src/test/java/org/courtside/dataexchange/web/RetentionAdminControllerTest.java#givenARemovableFormerMember_whenTheRunApplies_thenThePersonAndTheirAccountLeaveAndTheLogKeepsCountsOnly`.

Negative tests: `src/test/java/org/courtside/dataexchange/web/RetentionAdminControllerTest.java#givenAPreviewOfAnotherAccount_whenRun_thenItIsRefusedAndNobodyIsRemoved`, `src/test/java/org/courtside/dataexchange/web/RetentionAdminControllerTest.java#givenAnExpiredPreview_whenRun_thenItIsRefusedAsExpiredAndNobodyIsRemoved`, `src/test/java/org/courtside/dataexchange/web/RetentionAdminControllerTest.java#givenARunPreview_whenRunAgain_thenTheSecondRequestFindsNoPreview`, `src/test/java/org/courtside/dataexchange/web/RetentionAdminControllerTest.java#givenAPreviewUnderAPeriod_whenThePeriodIsRemoved_thenThePreviewCanNoLongerRun`, `src/test/java/org/courtside/dataexchange/ConcurrentRetentionRunTest.java#givenABoardLengtheningThePeriodWhileTheRunStarts_whenTheRunReachesThePreview_thenItWaitsAndRunsNothing`.

### Import preview read projection

Every administrator may read a stored preview; after its retention expires, personal change details and ignored columns are removed while non-personal counts and hashes remain.

Attributes: `administrator`, `preview-expiry`, `response-schema`.

Production: `src/main/java/org/courtside/dataexchange/PreviewService.java#toSummary`, `src/main/java/org/courtside/dataexchange/web/ImportPreviewAdminController.java#readImportPreview`, `src/main/java/org/courtside/dataexchange/web/ImportPreviewAdminController.java#toResponse`.

Positive tests: `src/test/java/org/courtside/dataexchange/web/ImportPreviewAdminControllerTest.java#givenAFileOfPeopleThisSourceHasNotSeen_whenPreviewing_thenEveryRowIsACreationAndNothingIsWritten`.

Negative tests: `src/test/java/org/courtside/dataexchange/PreviewRetentionTest.java#givenAPreviewPastItsRetention_whenReadingIt_thenTheCountsRemainAndTheChangeSetIsGone`.

### Public response projection

Public configuration and calendar responses use dedicated DTO projections and never widen to administrative configuration, roster or another person's booking details.

Attributes: `viewer-account`, `booking-owner`, `booking-card-generic-occupancy`, `public-schema`.

Production: `src/main/java/org/courtside/config/web/ConfigController.java#toResponse`, `src/main/java/org/courtside/card/web/CardController.java#listBookingCardLegend`, `src/main/java/org/courtside/booking/internal/AllocationVisibilityService.java#resolve`, `src/main/java/org/courtside/booking/internal/AllocationVisibilityService.java#participantPersonIds`, `src/main/java/org/courtside/booking/web/BookingController.java#listAllocations`, `src/main/java/org/courtside/booking/web/BookingController.java#toResponse`, `src/main/java/org/courtside/booking/web/WaitlistController.java#listReservedSlots`, `src/main/java/org/courtside/booking/waitlist/WaitlistService.java#reservationsBetween`.

Positive tests: `src/test/java/org/courtside/card/web/CardControllerTest.java#givenRoleRestrictedAndInactiveCards_whenListingTheLegend_thenEveryActiveCardIsPublic`, `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenABookingOnADay_whenRequestingThatDaysGrid_thenTheBookingIsListed`, `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenOwnBookingWithAnotherMember_whenLoadingTheGrid_thenOnlyOwnershipAndSurnameAreVisible`, `src/test/java/org/courtside/booking/web/WaitlistControllerTest.java#givenAnOffer_whenItsHolderReadsTheReservedSlots_thenTheirEntryLeadsToIt`.

Negative tests: `src/test/java/org/courtside/card/web/CardControllerTest.java#whenListingTheLegend_thenBookingRulesAreNotExposed`, `src/test/java/org/courtside/config/web/ConfigControllerTest.java#whenReadingThePublicConfig_thenItPublishesNothingOnlyABoardShouldSee`, `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenAnotherMembersBooking_whenLoadingTheGrid_thenOwnershipAndParticipantsAreHidden`, `src/test/java/org/courtside/booking/web/BookingControllerTest.java#givenAnonymousCaller_whenLoadingTheGrid_thenOwnershipAndParticipantsAreHidden`, `src/test/java/org/courtside/booking/web/WaitlistControllerTest.java#givenAnOffer_whenAVisitorReadsTheReservedSlots_thenTheCourtIsHeldAndNobodyIsNamed`.

### Participant directory projection

Participant search returns only the stable person identifier and display name of current members other than the searching person, never roster, account, address or membership administration fields.

Attributes: `current-membership`, `permanent-account`, `participant-schema`.

Production: `src/main/java/org/courtside/member/web/ParticipantMemberController.java#searchParticipantMembers`.

Positive tests: `src/test/java/org/courtside/member/web/ParticipantMemberControllerTest.java#givenMembersAndANonMember_whenSearchingByName_thenOnlyMatchingMembersAreReturned`.

Negative tests: `src/test/java/org/courtside/member/web/ParticipantMemberControllerTest.java#givenNoSession_whenSearchingMembers_thenItIsUnauthenticated`.

### Members' door code projection

The door codes derive identity from the current account and list the name and static code of each active access point open to members only when that account is enabled and its person holds a membership period covering today; anybody else receives an empty list rather than a refusal.

Attributes: `current-account`, `current-membership`.

Production: `src/main/java/org/courtside/booking/web/DoorCodeController.java#listMembersDoorCodes`, `src/main/java/org/courtside/member/MemberService.java#isCurrentMember`, `src/main/java/org/courtside/facility/FacilityService.java#membersDoorCodes`.

Positive tests: `src/test/java/org/courtside/booking/web/MembersDoorCodeVisibilityTest.java#givenACurrentMemberWithoutAnyBooking_whenReadingTheDoorCodes_thenOnlyTheClubhouseCodeComes`.

Negative tests: `src/test/java/org/courtside/booking/web/MembersDoorCodeVisibilityTest.java#givenAFormerMember_whenReadingTheDoorCodes_thenTheListIsEmpty`, `src/test/java/org/courtside/booking/web/MembersDoorCodeVisibilityTest.java#givenACurrentMemberWhoseAccountIsDisabled_whenReadingTheDoorCodes_thenTheListIsEmpty`.

### Administrative response projection

Administrative DTOs may expose the documented roster and operational fields to ADMIN only; credentials remain absent and subject access omits other people's booking data.

Attributes: `administrator`, `response-schema`, `subject-person`.

Production: `src/main/java/org/courtside/member/RosterService.java#load/1`, `src/main/java/org/courtside/member/RosterService.java#load/2`, `src/main/java/org/courtside/member/RosterService.java#requiredLanguage/1`, `src/main/java/org/courtside/member/web/RosterAdminController.java#toResponse`, `src/main/java/org/courtside/member/internal/RosterSecurityEventLog.java#record`, `src/main/java/org/courtside/config/web/ConfigController.java#toAdminResponse`, `src/main/java/org/courtside/audit/internal/DomainEventWriter.java#actor`, `src/main/java/org/courtside/audit/internal/AuditService.java#matchesBase`, `src/main/java/org/courtside/audit/web/AuditAdminController.java#toResponse`, `src/main/java/org/courtside/notification/web/MessageAdminController.java#toResponse`, `src/main/java/org/courtside/operations/web/OperationalLogAdminController.java#searchOperationalLogs`, `src/main/java/org/courtside/dataexchange/web/SubjectAccessAdminController.java#toResponse`, `src/main/java/org/courtside/dataexchange/web/ExternalReferenceAdminController.java#toResponse`, `src/main/java/org/courtside/dataexchange/web/ImportPreviewAdminController.java#createImportPreview`, `src/main/java/org/courtside/dataexchange/web/ImportPreviewAdminController.java#toResponse`, `src/main/java/org/courtside/dataexchange/web/ImportExecutionAdminController.java#toResponse`, `src/main/java/org/courtside/dataexchange/web/ExportAdminController.java#exportRoster`, `src/main/java/org/courtside/dataexchange/web/ExportAdminController.java#exportBookings`, `src/main/java/org/courtside/dataexchange/web/ExportAdminController.java#exportAuditLog`, `src/main/java/org/courtside/dataexchange/web/ExportAdminController.java#exportMessageLog`.

Positive tests: `src/test/java/org/courtside/dataexchange/web/SubjectAccessAdminControllerTest.java#givenAPersonTheInstanceHoldsEverythingAbout_whenABoardAsks_thenEachOfThoseThingsIsAnswered`, `src/test/java/org/courtside/operations/OperationalLogAdminControllerTest.java#givenAnAdministratorAndPrivateCriteria_whenSearching_thenTheMatchingPageIsReturned`.

Negative tests: `src/test/java/org/courtside/dataexchange/web/SubjectAccessAdminControllerTest.java#givenABookingSomebodyElseMade_whenABoardAsksAboutTheNamedMember_thenNeitherMakerNorNoteIsNamed`, `src/test/java/org/courtside/operations/OperationalLogAdminControllerTest.java#givenAMemberOrMissingCsrf_whenSearching_thenAccessIsRefused`, `src/test/java/org/courtside/dataexchange/web/LogExportAdminControllerTest.java#givenAMember_whenTheyAskForEitherLog_thenTheyAreRefusedAndNothingIsRecorded`.

### Password-first pending MFA login

MFA login entry points admit a request before full authentication, but succeed only for its password-verified pending session and unexpired account/session/purpose/epoch-bound challenge. Only a valid factor consumes that challenge, rotates the session, grants roles and records sign-in. Generic malformed requests do not prove successful authorization.

Attributes: `mfa-pending-session`, `mfa-challenge`, `mfa-security-epoch`, `mfa-guess-budget`.

Production: `src/main/java/org/courtside/identity/internal/MfaLogin.java#begin`, `src/main/java/org/courtside/identity/internal/MfaLogin.java#complete`, `src/main/java/org/courtside/identity/internal/MfaLogin.java#webAuthnOptions`, `src/main/java/org/courtside/identity/internal/MfaLogin.java#completeWebAuthn`, `src/main/java/org/courtside/identity/internal/MfaLogin.java#finish`, `src/main/java/org/courtside/identity/internal/MfaSessionAuthentication.java#complete`, `src/main/java/org/courtside/identity/internal/SessionMfaController.java#completeMfaLogin`, `src/main/java/org/courtside/identity/internal/SessionWebauthnController.java#pending`, `src/main/java/org/courtside/identity/internal/SessionWebauthnController.java#challenge`.

Positive tests: `src/test/java/org/courtside/identity/internal/MfaLoginTest.java#givenAPendingLogin_whenTheSecondFactorSucceeds_thenAReplacementSessionHasAccountPrivileges`.

Negative tests: `src/test/java/org/courtside/identity/internal/MfaLoginTest.java#givenEnabledMfa_whenOnlyThePasswordSucceeds_thenNoIdentityOrAccountAccessIsGranted`, `src/test/java/org/courtside/identity/internal/MfaLoginTest.java#givenARevokedPendingLogin_whenTheCodeIsCorrect_thenItStillCannotAuthenticate`.

### Private MFA holder scope

An authenticated permanent account selects its MFA state by immutable principal ID. Changes refresh and lock that account, require its current epoch, enabled state and no pending rescue. A native credential may be renamed or removed only by its holder. Holder-private labels, usage times and credential identities never enter administrative or ordinary export projections.

Attributes: `current-account`, `mfa-security-epoch`, `mfa-recovery-pending`, `response-schema`.

Production: `src/main/java/org/courtside/identity/internal/MfaManagement.java#status`, `src/main/java/org/courtside/identity/internal/MfaManagement.java#currentHolderForUpdate`, `src/main/java/org/courtside/identity/internal/MfaManagement.java#currentForChange`, `src/main/java/org/courtside/identity/internal/MfaWebAuthnFlow.java#ownCredential`, `src/main/java/org/courtside/identity/internal/MfaWebAuthnFlow.java#remove`, `src/main/java/org/courtside/identity/internal/MfaWebAuthnFlow.java#rename`.

Positive tests: `src/test/java/org/courtside/identity/internal/MfaManagementTest.java#givenAReusedUsername_whenReadingPrivateFactorStatus_thenThePrincipalAccountKeepsItsOwnData`.

Negative tests: `src/test/java/org/courtside/identity/internal/MfaManagementTest.java#givenAReusedPrincipalName_whenTheLockedAccountHasAnotherIdentity_thenItCannotReceiveTheFirstHoldersSetup`, `src/test/java/org/courtside/identity/internal/MfaWebAuthnFlowTest.java#givenAnUnknownCredential_whenTheHolderRemovesIt_thenTheResponseNamesAnAbsentResource`.

### MFA method and ceremony proof

First enrollment requires recent password proof; changes to an enrolled account require recent password plus an existing factor. TOTP activates only after a valid unused step. Native WebAuthn registration/assertion checks origin, RP, challenge, user verification, credential owner and monotone counter. Codes and setup secrets appear only in their holder generating response; only verifiers or account-bound ciphertext remain stored.

Attributes: `mfa-factor-enabled`, `mfa-challenge`, `mfa-guess-budget`, `current-account`, `recent-authentication`.

Production: `src/main/java/org/courtside/identity/internal/MfaManagement.java#beginTotp`, `src/main/java/org/courtside/identity/internal/MfaManagement.java#confirmTotp`, `src/main/java/org/courtside/identity/internal/MfaManagement.java#replaceRecoveryCodes`, `src/main/java/org/courtside/identity/internal/MfaWebAuthnFlow.java#beginRegistration`, `src/main/java/org/courtside/identity/internal/MfaWebAuthnFlow.java#register`, `src/main/java/org/courtside/identity/internal/MfaWebAuthnFlow.java#beginReauthentication`, `src/main/java/org/courtside/identity/internal/MfaWebAuthnFlow.java#verifyReauthentication`, `src/main/java/org/courtside/identity/internal/MfaWebAuthn.java#register`, `src/main/java/org/courtside/identity/internal/MfaWebAuthn.java#verify`, `src/main/java/org/courtside/identity/internal/MfaChallenges.java#lockCurrentAccount`.

Positive tests: `src/test/java/org/courtside/identity/internal/MfaManagementTest.java#givenFreshPasswordProof_whenEnrollingAndConfirmingTotp_thenCodesAreShownOnceAndOldSessionsAreRevoked`, `src/test/java/org/courtside/identity/internal/MfaWebAuthnFlowTest.java#givenNoTotp_whenEnrollingAndUsingWebAuthn_thenPasswordAndTheEnrolledKeyGrantAccountAccess`.

Negative tests: `src/test/java/org/courtside/identity/internal/MfaManagementTest.java#givenPendingSetup_whenAnInvalidCodeIsConfirmed_thenMfaAndRecoveryCodesRemainDisabled`, `src/test/java/org/courtside/identity/internal/MfaWebAuthnTest.java#givenAnInvalidSignedAssertion_whenVerifying_thenTheStoredCounterAndOwnerStayUnchanged`.

### Administrative MFA projection

Only ADMIN may read another account MFA status. That projection contains only enabled and recovery-pending flags, with no method identities, labels, usage metadata, setup secret or recovery code.

Attributes: `administrator`, `target-account`, `response-schema`.

Production: `src/main/java/org/courtside/identity/internal/MfaRecoveryController.java#getAdministrativeMfaStatus`.

Positive tests: `src/test/java/org/courtside/identity/internal/MfaRecoveryFlowTest.java#givenFreshMfaAdmin_whenRecoveringALostAccount_thenOnlyTheMailedCodeAndNewPasswordUnblockIt`.

Negative tests: `src/test/java/org/courtside/identity/internal/MfaRecoveryFlowTest.java#givenAMember_whenReadingAnotherAccountsMfaStatus_thenThePrivateAccountRouteIsRefused`.

### Controlled MFA account rescue

Rescue initiation requires a currently enabled ADMIN with active MFA, fresh full proof and explicit external identity confirmation. It revokes sessions and blocks ordinary credential routes while retaining factors. Public redemption requires the single-use mailed code, matching username/current address/security epoch, unexpired state, persistent guess budget and acceptable permanent password. Only successful redemption removes factors and clears the block. Operator rescue and separately audited address correction require identity confirmation. Ordinary credential and reset-code jobs queued before rescue must finish permanently without replacing recovered credentials or leaving a usable reset code, including delayed and retried jobs. New requests after completed rescue follow the ordinary policy.

Attributes: `administrator`, `recent-authentication`, `mfa-factor-enabled`, `mfa-identity-check`, `mfa-current-address`, `mfa-security-epoch`, `mfa-guess-budget`, `mfa-recovery-pending`.

Production: `src/main/java/org/courtside/identity/internal/ControlledAccountRecovery.java#initiate`, `src/main/java/org/courtside/identity/internal/ControlledAccountRecovery.java#initiateLocked`, `src/main/java/org/courtside/identity/internal/ControlledAccountRecovery.java#redeem`, `src/main/java/org/courtside/identity/internal/ControlledAccountRecovery.java#correctEmailFromMaintenance`, `src/main/java/org/courtside/identity/internal/ControlledAccountRecovery.java#valid`, `src/main/java/org/courtside/identity/internal/RecoveryAccountGuard.java#lockAndRequireAvailable`, `src/main/java/org/courtside/identity/internal/AccountCredentialIssuer.java#issueFor`, `src/main/java/org/courtside/notification/internal/MailOutbox.java#handOverAndSettle`, `src/main/java/org/courtside/notification/internal/MailOutbox.java#supersededCredential`.

Positive tests: `src/test/java/org/courtside/identity/internal/ControlledAccountRecoveryTest.java#givenFreshMfaAdministrator_whenIdentityWasChecked_thenRecoveryStarts`, `src/test/java/org/courtside/identity/internal/ControlledAccountRecoveryTest.java#givenLostFactors_whenMaintenanceStartsRecovery_thenOldFactorsRemainAndOnlyAPasswordRedemptionRemovesThem`, `src/test/java/org/courtside/identity/internal/ControlledAccountRecoveryTest.java#givenAnOldUnstartedCredentialJob_whenRecoveryCompletes_thenOnlyAnExplicitNewRequestCanIssueACredential`.

Negative tests: `src/test/java/org/courtside/identity/internal/ControlledAccountRecoveryTest.java#givenAdministratorWithoutMfa_whenRequestingRecovery_thenItIsRefused`, `src/test/java/org/courtside/identity/internal/ControlledAccountRecoveryTest.java#givenUnconfirmedIdentity_whenMaintenanceStartsRecovery_thenNothingChanges`, `src/test/java/org/courtside/identity/internal/ControlledAccountRecoveryTest.java#givenAddressChangedWithoutAnEpochChange_whenOldRecoveryCodeIsRedeemed_thenItsAddressBindingRefusesIt`, `src/test/java/org/courtside/identity/internal/ControlledAccountRecoveryTest.java#givenAnOutboxCredentialBeingSent_whenRecoveryCompletes_thenTheJobFailsPermanentlyWithoutOverwritingThePassword`, `src/test/java/org/courtside/identity/internal/ControlledAccountRecoveryTest.java#givenTwoOldCredentialJobs_whenTheSecondWaitsDuringRecovery_thenNeitherCanReplaceTheRecoveryPassword`, `src/test/java/org/courtside/identity/internal/ControlledAccountRecoveryTest.java#givenAnOldResetCodeJobWaitingForTheAccount_whenRecoveryCommits_thenItsIssuedTokenRollsBack`.

### Emergency code for a booking's participants

The emergency code derives identity from the current account and is answered only to the booking's owner or a person it names as a player, from the start of its access window to its end and only for its active access points without a static code that keep one; anybody else is refused with a violation code and nothing is recorded.

Attributes: `current-account`, `booking-owner`, `participant-person`.

Production: `src/main/java/org/courtside/booking/web/EmergencyCodeController.java#answer`, `src/main/java/org/courtside/booking/internal/EmergencyCodes.java#request`, `src/main/java/org/courtside/booking/internal/EmergencyCodes.java#takesPart`.

Positive tests: `src/test/java/org/courtside/booking/web/DynamicAccessCodeTest.java#givenTheBookerAndThePlayerInsideTheWindow_whenTheyAskForTheEmergencyCode_thenItIsAnsweredAndAudited`.

Negative tests: `src/test/java/org/courtside/booking/web/DynamicAccessCodeTest.java#givenAnotherMembersBooking_whenAMemberOutsideItAsksForTheEmergencyCode_thenItIsRefusedWithoutTheCode`, `src/test/java/org/courtside/booking/web/DynamicAccessCodeTest.java#givenABookingWhoseWindowHasNotOpened_whenTheBookerAsksForTheEmergencyCode_thenItIsRefusedByReason`.

## Protected field rules

| Rule | Access | Fields | Operations | Actors and attributes |
|---|---|---|---|---|
| `login-credentials-write-only` | never-read | `$request.username`, `$request.password` | `logIn` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `dedicated-workflow`, `request-field` |
| `session-identity-read` | read | `SessionStatus.username`, `SessionStatus.displayName`, `SessionStatus.firstName`, `SessionStatus.lastName`, `SessionStatus.locale`, `SessionStatus.roles`, `SessionStatus.passwordChangeRequired`, `SessionStatus.managesAppointments`, `SessionStatus.createsSeries`, `SessionStatus.mfaRequired`, `SessionStatus.mfaEnabled`, `SessionStatus.totpAvailable`, `SessionStatus.webauthnAvailable` | `getSessionStatus` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `current-session` |
| `own-session-metadata-read` | read | `AccountSession.handle`, `AccountSession.createdAt`, `AccountSession.lastActivityAt`, `AccountSession.current`, `AccountSession.browserFamily` | `listOwnSessions` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account` |
| `initial-credential-input-write-only` | never-read | `InitialPasswordChangeRequest.password` | `changeInitialPassword` | `INITIAL_PASSWORD`; `dedicated-workflow` |
| `permanent-password-change-write-only` | never-read | `PasswordChangeRequest.currentPassword`, `PasswordChangeRequest.newPassword` | `changeOwnPassword` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `dedicated-workflow`, `current-account` |
| `reauthentication-password-write-only` | never-read | `ReauthenticationRequest.password`, `ReauthenticationRequest.code`, `ReauthenticationRequest.credential` | `reauthenticate` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `dedicated-workflow`, `current-account` |
| `participant-member-read` | read | `PublicParticipantMember.personId`, `PublicParticipantMember.displayName` | `searchParticipantMembers` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-membership` |
| `public-allocation-read` | read | `Allocation.ownBooking`, `Allocation.participantLastNames`, `Allocation.bookedByName`, `Allocation.cardLabel`, `Allocation.cardColor` | `listAllocations` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `viewer-account`, `booking-owner`, `booking-card-generic-occupancy` |
| `personal-booking-read` | read | `PersonalBooking.id`, `PersonalBooking.seriesId`, `PersonalBooking.note` | `listPersonalBookings`, `listDependantBookings` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `booking-owner`, `current-account` |
| `dependant-read` | read | `Dependant.personId`, `Dependant.firstName`, `Dependant.lastName`, `Dependant.grants`, `Dependant.endedOn` | `listDependants` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `guardian-relationship` |
| `managed-booking-detail-read` | read | `ManagedAppointmentDetail.note`, `ManagedAppointmentDetail.participants`, `ManagedParticipant.displayName`, `ManagedAppointmentDetail.attendance` | `getManagedAppointment` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `booking-card`, `managing-role`, `administrator-override` |
| `roster-person-create` | write | `PersonRequest.firstName`, `PersonRequest.lastName`, `PersonRequest.email` | `createPerson` | `ADMIN`; `administrator` |
| `roster-person-correction` | write | `PersonRequest.firstName`, `PersonRequest.lastName`, `PersonRequest.email` | `changePerson` | `ADMIN`; `administrator`, `recent-authentication` |
| `account-create-write` | write | `AccountRequest.username`, `AccountRequest.roles` | `createAccount` | `ADMIN`; `administrator`, `recent-authentication` |
| `account-username-write` | write | `UsernameRequest.username` | `changeAccountUsername` | `ADMIN`; `administrator`, `recent-authentication` |
| `account-role-write` | write | `RolesRequest.roles` | `changeAccountRoles` | `ADMIN`; `administrator`, `recent-authentication`, `enabled-administrator-count` |
| `account-enabled-write` | write | `ActiveRequest.active` | `setAccountActive` | `ADMIN`; `administrator`, `recent-authentication`, `enabled-administrator-count` |
| `roster-and-account-read` | read | `RosterEntry.personId`, `RosterEntry.firstName`, `RosterEntry.lastName`, `RosterEntry.email`, `RosterEntry.accountId`, `RosterEntry.username`, `RosterEntry.locale`, `RosterEntry.addressSharedBy`, `RosterEntry.credentialState`, `RosterEntry.enabled`, `RosterEntry.membershipTypeId`, `RosterEntry.membershipStartedOn`, `RosterEntry.membershipEndedOn`, `RosterEntry.roles`, `RosterEntry.membershipCurrent`, `RosterEntry.membershipState` | `searchRoster`, `createPerson`, `readPerson`, `changePerson`, `createAccount`, `changeAccountRoles`, `changeAccountUsername`, `changeAccountLocale`, `requestAccountCredentials`, `setAccountActive`, `assignMembership` | `ADMIN`; `administrator`, `target-person` |
| `membership-period-read` | read | `MembershipPeriod.id`, `MembershipPeriod.membershipTypeId`, `MembershipPeriod.startedOn`, `MembershipPeriod.endedOn`, `MembershipPeriod.state` | `listMembershipPeriods`, `addMembershipPeriod`, `correctMembershipPeriod` | `ADMIN`; `administrator`, `target-person` |
| `guardian-relationship-read` | read | `GuardianRelationship.id`, `GuardianRelationship.guardian`, `GuardianRelationship.dependant`, `GuardianRelationship.grants`, `GuardianRelationship.startedOn`, `GuardianRelationship.endedOn`, `GuardianRelationship.state` | `listGuardianRelationships`, `createGuardianRelationship`, `changeGuardianRelationship`, `endGuardianRelationship` | `ADMIN`; `administrator`, `target-person` |
| `administrative-config-read-write` | read | `AdminClubConfig.newAccountCredentialHours`, `AdminClubConfig.passwordResetCredentialHours`, `AdminClubConfig.bookingReminderHours`, `AdminClubConfig.noMembershipTypeRuleSetId` | `getClubConfigForAdmin`, `changeClubConfig`, `uploadClubLogo`, `deleteClubLogo` | `ADMIN`; `administrator` |
| `administrative-config-write` | write | `ClubConfigRequest.newAccountCredentialHours`, `ClubConfigRequest.passwordResetCredentialHours`, `ClubConfigRequest.bookingReminderHours`, `ClubConfigRequest.noMembershipTypeRuleSetId` | `changeClubConfig` | `ADMIN`; `administrator` |
| `booking-party-write` | write | `ParticipantRequest.personId`, `ParticipantRequest.guestName`, `ParticipantRequest.cardId`, `CreateBookingRequest.note`, `CreateBookingRequest.participants` | `createBooking`, `createDependantBooking` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `booking-card`, `allowed-role`, `current-membership` |
| `booking-series-note-write` | write | `SeriesRuleRequest.note` | `previewSeries`, `createSeries` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `booking-card`, `allowed-role` |
| `audit-record-read` | read | `AuditEntry.parameters`, `AuditEntry.subjectId`, `AuditEntry.subjectName`, `AuditEntry.subjectPeriod`, `AuditEntry.actorAccountId`, `AuditEntry.actorUsername` | `readAuditLog`, `searchAuditLog` | `ADMIN`; `administrator` |
| `message-record-read` | read | `MessageEntry.messageId`, `MessageEntry.personId`, `MessageEntry.personName` | `readMessageLog` | `ADMIN`; `administrator` |
| `operational-log-query-write` | write | `OperationalLogSearchRequest.text`, `OperationalLogSearchRequest.traceId` | `searchOperationalLogs` | `ADMIN`; `administrator` |
| `operational-log-record-read` | read | `OperationalLogEntry.message`, `OperationalLogEntry.traceId` | `searchOperationalLogs` | `ADMIN`; `administrator` |
| `subject-access-read` | read | `SubjectAccessExport.personId`, `SubjectAccessExport.firstName`, `SubjectAccessExport.lastName`, `SubjectAccessExport.email`, `SubjectAccessExport.accounts`, `SubjectAccessExport.memberships`, `SubjectAccessExport.bookingsMade`, `SubjectAccessExport.bookingsRecordedIn`, `SubjectAccessExport.externalReferences`, `SubjectAccessExport.changesAsSubject`, `SubjectAccessExport.changesAsActor`, `SubjectAccessExport.waitlistEntries`, `SubjectAccessExport.waitlistsNamedIn`, `SubjectAccessExport.guardianships`, `SubjectAccessExport.bookingsActedFor` | `exportPersonData` | `ADMIN`; `administrator`, `subject-person` |
| `external-reference-person-data-read` | read | `ExternalReference.externalId`, `ExternalReference.personId`, `ExternalReference.personName` | `listExternalReferences`, `linkExternalReference` | `ADMIN`; `administrator` |
| `import-preview-person-data-read` | read | `ImportPersonChange.externalId`, `ImportPersonChange.personId`, `ImportPersonChange.personName`, `ImportPersonChange.values`, `ImportPossibleDuplicate.externalId`, `ImportPossibleDuplicate.personId`, `ImportPossibleDuplicate.personName`, `ImportSharedAddress.externalId` | `createImportPreview`, `readImportPreview` | `ADMIN`; `administrator`, `preview-expiry` |
| `account-recovery-name` | write | `PasswordResetRequest.username` | `requestPasswordReset` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `route`, `request-field` |
| `account-recovery-redemption` | never-read | `PasswordResetRedemptionRequest.code`, `PasswordResetRedemptionRequest.password` | `redeemPasswordReset` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `route`, `request-field` |
| `account-recovery-address` | write | `UsernameReminderRequest.email` | `requestUsernameReminder` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `route`, `request-field` |
| `waitlist-party-write` | write | `ParticipantRequest.personId`, `ParticipantRequest.guestName`, `ParticipantRequest.cardId`, `JoinWaitlistRequest.note`, `JoinWaitlistRequest.participants` | `joinWaitlist` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `booking-card`, `allowed-role`, `current-membership` |
| `own-waitlist-read` | read | `WaitlistEntry.id`, `WaitlistEntry.state`, `WaitlistEntry.offerExpiresAt`, `WaitlistEntry.bookingId` | `listOwnWaitlistEntries` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `waitlist-entry-owner` |
| `open-place-read` | read | `OpenPlace.invitationId` | `listOpenPlaces` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `booking-card`, `allowed-role` |
| `reserved-slot-holder-read` | read | `ReservedSlot.ownEntryId` | `listReservedSlots` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `viewer-account`, `waitlist-entry-owner` |
| `no-show-record-read` | read | `NoShow.bookingId`, `NoShow.startsAt`, `NoShow.endsAt` | `listNoShows` | `ADMIN`; `administrator`, `target-person` |
| `retention-blocked-read` | read | `RetentionBlockedRecord.personId`, `RetentionBlockedRecord.reason` | `previewRetention` | `ADMIN`; `administrator`, `target-person` |
| `own-mfa-state-read` | read | `MfaStatus.enabled`, `MfaStatus.totpEnabled`, `MfaStatus.recoveryCodesRemaining`, `MfaStatus.webauthnAvailable`, `MfaStatus.devices` | `getOwnMfaStatus` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account` |
| `totp-setup-holder-read` | read | `TotpEnrollment.secret`, `TotpEnrollment.uri` | `beginTotpEnrollment` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `recent-authentication` |
| `recovery-set-generating-holder-read` | read | `MfaRecoveryCodeSet.codes` | `confirmTotpEnrollment`, `confirmWebauthnEnrollment`, `replaceOwnRecoveryCodes` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `recent-authentication` |
| `pending-mfa-code-write-only` | never-read | `MfaCodeProof.code` | `completeMfaLogin` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `mfa-pending-session`, `mfa-challenge` |
| `totp-confirmation-write-only` | never-read | `MfaCodeProof.code` | `confirmTotpEnrollment` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `recent-authentication` |
| `webauthn-registration-context-read` | read | `WebAuthnCreationOptions.user`, `WebAuthnCreationOptions.challenge`, `WebAuthnCreationOptions.excludeCredentials`, `WebAuthnCreationOptions.extensions` | `beginWebauthnEnrollment` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `mfa-challenge` |
| `webauthn-pending-assertion-context-read` | read | `WebAuthnRequestOptions.challenge`, `WebAuthnRequestOptions.allowCredentials`, `WebAuthnRequestOptions.extensions` | `beginWebauthnLogin` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `mfa-pending-session`, `mfa-challenge` |
| `webauthn-holder-assertion-context-read` | read | `WebAuthnRequestOptions.challenge`, `WebAuthnRequestOptions.allowCredentials`, `WebAuthnRequestOptions.extensions` | `beginWebauthnReauthentication` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `mfa-challenge` |
| `webauthn-registration-proof-write-only` | never-read | `WebAuthnEnrollmentRequest.credential` | `confirmWebauthnEnrollment` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `mfa-challenge` |
| `webauthn-enrollment-label-write` | write | `WebAuthnEnrollmentRequest.label` | `confirmWebauthnEnrollment` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `recent-authentication` |
| `webauthn-holder-label-write` | write | `WebAuthnLabelRequest.label` | `renameOwnWebauthnCredential` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `recent-authentication` |
| `webauthn-pending-proof-write-only` | never-read | `WebAuthnAssertionCredential.id`, `WebAuthnAssertionCredential.rawId`, `WebAuthnAssertionCredential.type`, `WebAuthnAssertionCredential.response`, `WebAuthnAssertionCredential.clientExtensionResults`, `WebAuthnAssertionCredential.authenticatorAttachment` | `completeWebauthnLogin` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `mfa-pending-session`, `mfa-challenge` |
| `administrative-mfa-flags-read` | read | `MfaAdministrativeStatus.enabled`, `MfaAdministrativeStatus.recoveryPending` | `getAdministrativeMfaStatus` | `ADMIN`; `administrator`, `target-account` |
| `controlled-rescue-identity-confirmation-write` | write | `MfaRecoveryInitiation.identityChecked` | `initiateMfaRecovery` | `ADMIN`; `administrator`, `recent-authentication`, `mfa-identity-check` |
| `controlled-rescue-redemption-write-only` | never-read | `MfaRecoveryRedemption.username`, `MfaRecoveryRedemption.code`, `MfaRecoveryRedemption.password` | `redeemMfaRecovery` | `ANONYMOUS`, `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`, `INITIAL_PASSWORD`; `mfa-current-address`, `mfa-guess-budget` |
| `access-point-code-read` | read | `AccessPoint.staticCode`, `AccessPoint.emergencyCode` | `listAccessPoints`, `createAccessPoint`, `getAccessPoint`, `changeAccessPoint`, `setAccessPointActive` | `ADMIN`; `administrator` |
| `access-point-code-write` | write | `AccessPointRequest.staticCode`, `AccessPointRequest.emergencyCode` | `createAccessPoint`, `changeAccessPoint` | `ADMIN`; `administrator` |
| `booking-access-code-read` | read | `PersonalBooking.access` | `listPersonalBookings`, `listDependantBookings` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `booking-owner`, `current-account` |
| `participation-access-code-read` | read | `Participation.access` | `listOwnParticipations` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `participant-person`, `current-account` |
| `members-door-code-read` | read | `AccessCode.code` | `listMembersDoorCodes` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `current-account`, `current-membership` |
| `emergency-code-read` | read | `EmergencyAccess.codes` | `requestEmergencyCode`, `requestParticipationEmergencyCode` | `MEMBER`, `TRAINER`, `SPORT_DIRECTOR`, `YOUTH_DIRECTOR`, `GROUNDSKEEPER`, `TREASURER`, `ADMIN`; `booking-owner`, `participant-person`, `current-account` |

Every field not declared by an operation's OpenAPI request schema is rejected before the operation runs. Every field not declared by its response schema is outside that operation's projection. The rules above name the fields whose visibility or mutability is narrower than merely satisfying that schema.
