stalwart_image() {
  sed -n 's/^[[:space:]]*image: \(stalwartlabs\/stalwart:[^[:space:]]*\)$/\1/p' "$1/compose.stalwart.yaml"
}

retained_mail_recovery() {
  local candidate=$1 history
  for history in "$installation_directory/.courtside-mail-transition" "$installation_directory"/backups/mail-transition-*; do
    [ -d "$history" ] && [ ! -L "$history" ] && [ -f "$history/state" ] && [ ! -L "$history/state" ] || continue
    [ "$(recovery_value "$history/state" recovery)" != "$candidate" ] || return 0
  done
  return 1
}

report_mail_transition_histories() {
  local history owner recovery config data store_use
  for history in "$installation_directory"/backups/mail-transition-*; do
    [ -d "$history" ] && [ ! -L "$history" ] && [ -f "$history/state" ] && [ ! -L "$history/state" ] || continue
    owner=$(recovery_value "$history/state" owner)
    [[ "$owner" =~ ^[a-f0-9]{48}$ ]] || continue
    recovery=$(recovery_value "$history/state" recovery)
    [[ "$recovery" =~ ^[A-Za-z0-9._/-]+$ ]] || recovery=unknown
    config="${config_project}_mail-config-stalwart1-$owner"
    data="${config_project}_mail-data-stalwart1-$owner"
    store_use=unused
    [ "$config" != "$selected_mail_config_volume" ] || store_use=selected
    printf 'Kept mail transition history %s: stores %s %s (%s), recovery unit %s\n' \
      "$history" "$config" "$data" "$store_use" "$recovery"
  done
}

prepare_mail_store_transition() {
  local archive=$1 mode=$2 source_major target_major key value
  mail_transition=false
  [ -z "$mode" ] || [ "$mode" = reinitialize ] || refuse "unknown mail store transition $mode"
  if [ "$config_recipe" != full-self-hosted ]; then
    [ -z "$mode" ] || refuse "mail store transition requires full-self-hosted"
    return 0
  fi
  validate_installed_release
  mail_source_image=$(stalwart_image "$installation_directory/current")
  mail_target_image=$(stalwart_image "$archive")
  [[ "$mail_source_image" =~ ^stalwartlabs/stalwart:v([0-9]+)\.[0-9]+\.[0-9]+@sha256:[0-9a-f]{64}$ ]] \
    || refuse "Stalwart store migration source is unknown"
  source_major=${BASH_REMATCH[1]}
  [[ "$mail_target_image" =~ ^stalwartlabs/stalwart:v([0-9]+)\.[0-9]+\.[0-9]+@sha256:[0-9a-f]{64}$ ]] \
    || refuse "Stalwart store migration target is unknown"
  target_major=${BASH_REMATCH[1]}
  if [ "$source_major" = "$target_major" ]; then
    [ -z "$mode" ] || refuse "mail store reinitialization requires the supported 0.16.27 to 1.0 transition"
    read_manifest "$archive/manifest.json"
    return 0
  fi
  [ "$mail_source_image" = stalwartlabs/stalwart:v0.16.27@sha256:c429b311c93db5606598abc1c68225a85a6953183848ae01bee9c6a98885836c ] \
    && [[ "$mail_target_image" =~ ^stalwartlabs/stalwart:v1\.0\.[0-9]+@sha256:[0-9a-f]{64}$ ]] \
    || refuse "unsupported Stalwart store migration; only the pinned 0.16.27 to 1.0.x transition is supported; an installation on an older Stalwart must update to Courtside 0.3.0 first"
  [ "$mode" = reinitialize ] \
    || refuse "Stalwart store migration requires explicit --mail-store-transition reinitialize; see guides/stalwart.md"
  [ ! -e "$installation_directory/config/local.override.yaml" ] \
    || refuse "mail store transition is unavailable with a local override"
  [ -z "$config_overlays" ] || refuse "mail store transition is unavailable with deployment overlays"
  [ "$config_recovery_material" = included ] || refuse "mail store transition requires complete recovery material"
  for key in COURTSIDE_MAIL_PASSWORD COURTSIDE_MAIL_SETUP_PASSWORD COURTSIDE_MAIL_ADMIN_PASSWORD COURTSIDE_MAIL_RELOAD_PASSWORD; do
    value=$(environment_value "$installation_directory/config/.env" "$key")
    [ -n "$value" ] || refuse "mail store transition requires managed mail credentials"
  done
  mail_transition=true
  read_manifest "$archive/manifest.json"
}

print_mail_store_transition() {
  [ "$mail_transition" = true ] || return 0
  printf 'mail_transition=reinitialize\nmail_source_image=%s\nmail_target_image=%s\n' "$mail_source_image" "$mail_target_image"
  printf 'retained_mail_config=%s\nretained_mail_data=%s\n' "$selected_mail_config_volume" "$selected_mail_data_volume"
  printf 'target_mail_config=%s_mail-config-stalwart1-<attempt>\ntarget_mail_data=%s_mail-data-stalwart1-<attempt>\n' "$config_project" "$config_project"
  printf 'Old messages, queued deliveries, manual accounts and settings are not copied.\n'
  printf 'Fresh DKIM keys require new DNS records. Local readiness does not prove external delivery.\n'
}

mail_transition_phase() {
  printf '%s\n' "$1" > "$mail_journal/phase.partial"
  chmod 600 "$mail_journal/phase.partial"
  mv "$mail_journal/phase.partial" "$mail_journal/phase"
}

reserve_mail_transition_stores() {
  local name logical owner
  for logical in config data; do
    if [ "$logical" = config ]; then name=$target_mail_config_volume; else name=$target_mail_data_volume; fi
    if "${docker_command[@]}" volume inspect "$name" >/dev/null 2>&1; then
      refuse "mail transition target already exists; recovery unit $created_recovery is ready"
    fi
    "${docker_command[@]}" volume create --label "org.courtside.mail-transition-owner=$mail_owner" \
      --label "com.docker.compose.project=$config_project" --label "com.docker.compose.volume=mail-$logical" "$name" >/dev/null \
      || refuse "mail transition volume creation failed; recovery unit $created_recovery is ready"
    owner=$("${docker_command[@]}" volume inspect "$name" --format '{{index .Labels "org.courtside.mail-transition-owner"}}') \
      || refuse "mail transition target ownership is unknown; recovery unit $created_recovery is ready"
    [ "$owner" = "$mail_owner" ] || refuse "mail transition target belongs to another attempt; recovery unit $created_recovery is ready"
  done
}

begin_mail_store_transition() {
  local archive=$1 digest=$2 published="$installation_directory/.courtside-mail-transition"
  mail_owner=$(random_secret)
  target_mail_config_volume="${config_project}_mail-config-stalwart1-$mail_owner"
  target_mail_data_volume="${config_project}_mail-data-stalwart1-$mail_owner"
  [ ! -e "$published" ] && [ ! -L "$published" ] || refuse "mail transition journal already exists"
  mail_journal=$(mktemp -d "$installation_directory/.mail-transition.partial.XXXXXX")
  temporary_path=$mail_journal
  chmod 700 "$mail_journal"
  {
    printf 'source_release=%s\ntarget_release=%s\nmanifest_sha=%s\nowner=%s\nrecovery=%s\n' \
      "$config_release" "$target_release" "$target_manifest_sha" "$mail_owner" "$created_recovery"
  } > "$mail_journal/state"
  chmod 600 "$mail_journal/state"
  mail_transition_phase preparing
  write_updated_environment "$mail_journal/target.env" "$digest" "$target_database_volume" "$target_mail_config_volume" "$target_mail_data_volume"
  cp "$mail_journal/target.env" "$mail_journal/setup.env"
  environment_line COURTSIDE_MAIL_RECOVERY_ADMIN \
    "admin:$(environment_value "$mail_journal/target.env" COURTSIDE_MAIL_SETUP_PASSWORD)" >> "$mail_journal/setup.env"
  chmod 600 "$mail_journal/setup.env"
  mv "$mail_journal" "$published"
  mail_journal=$published
  temporary_path=""
  reserve_mail_transition_stores
  mail_candidate_compose=("${docker_command[@]}" compose --project-name "$config_project" \
    --project-directory "$archive" --env-file "$mail_journal/setup.env")
  local file
  selection_arguments
  while IFS= read -r file; do mail_candidate_compose+=(-f "$archive/$file"); done \
    < <("$archive/recipe.sh" files "${selection[@]}")
}

wait_mail_transition_admin() {
  local object=$1 attempt
  for ((attempt=0; attempt<30; attempt++)); do
    if "${mail_candidate_compose[@]}" --profile mail-setup run --rm --no-deps mail-bootstrap get "$object"; then return 0; fi
    sleep 1
  done
  return 1
}

configure_mail_transition_target() {
  "${compose[@]}" stop app mail-reload || return 1
  "${mail_candidate_compose[@]}" --profile mail up -d --no-deps mail || return 1
  wait_mail_transition_admin Bootstrap || return 1
  if ! "${mail_candidate_compose[@]}" --profile mail-setup run --rm mail-bootstrap > "$mail_journal/bootstrap.log" 2>&1; then
    grep -q 'authentication failed (HTTP 401)' "$mail_journal/bootstrap.log" \
      && "${mail_candidate_compose[@]}" exec -T mail sh -c 'test -s /etc/stalwart/config.json' || return 1
  fi
  "${mail_candidate_compose[@]}" --profile mail restart mail || return 1
  wait_mail_transition_admin SystemSettings || return 1
  "${mail_candidate_compose[@]}" --profile mail-setup run --rm mail-configure || return 1
  local index
  for ((index=0; index<${#mail_candidate_compose[@]}; index++)); do
    if [ "${mail_candidate_compose[$index]}" = "$mail_journal/setup.env" ]; then
      mail_candidate_compose[$index]="$mail_journal/target.env"
    fi
  done
  "${mail_candidate_compose[@]}" --profile mail up -d --no-deps --force-recreate mail || return 1
  "${mail_candidate_compose[@]}" --profile mail up -d --wait mail-certificate mail-reload || return 1
  "${mail_candidate_compose[@]}" --profile mail-setup run --rm --no-deps mail-ready || return 1
}

retire_mail_transition() {
  local destination="$installation_directory/backups/mail-transition-$mail_owner"
  [ ! -e "$destination" ] && [ ! -L "$destination" ] || refuse "mail transition history already exists"
  mv "$mail_journal" "$destination"
}

mail_transition_allows() {
  local journal="$installation_directory/.courtside-mail-transition" file installed
  contains_word "backup restore-check diagnose doctor status" "$1" || return 1
  [ -d "$journal" ] && [ ! -L "$journal" ] || return 1
  for file in state phase; do
    [ -f "$journal/$file" ] && [ ! -L "$journal/$file" ] || return 1
  done
  [ "$(sed -n '1p' "$journal/phase")" = preparing ] || return 1
  installed=$(recovery_value "$installation_directory/config/installation.conf" release)
  [ -n "$installed" ] && [ "$(recovery_value "$journal/state" source_release)" = "$installed" ]
}

start_mail_transition_source() {
  "$@" --profile mail up -d --wait mail mail-certificate mail-reload && "$@" up -d app
}

read_mail_transition_journal() {
  local file
  mail_journal="$installation_directory/.courtside-mail-transition"
  [ -d "$mail_journal" ] && [ ! -L "$mail_journal" ] \
    && [ "$(path_mode "$mail_journal")" = 700 ] && [ "$(path_owner "$mail_journal")" = "$(id -u)" ] \
    || refuse "mail transition journal must be an operator-owned private directory"
  for file in state phase target.env; do
    [ -f "$mail_journal/$file" ] && [ ! -L "$mail_journal/$file" ] \
      && [ "$(path_mode "$mail_journal/$file")" = 600 ] && [ "$(path_owner "$mail_journal/$file")" = "$(id -u)" ] \
      || refuse "mail transition journal contains unsafe state"
  done
  mail_transition_source=$(recovery_value "$mail_journal/state" source_release)
  mail_transition_target=$(recovery_value "$mail_journal/state" target_release)
  mail_transition_digest=$(recovery_value "$mail_journal/state" manifest_sha)
  mail_owner=$(recovery_value "$mail_journal/state" owner)
  mail_transition_recovery=$(recovery_value "$mail_journal/state" recovery)
  mail_transition_state=$(< "$mail_journal/phase")
  [[ "$mail_transition_source" =~ ^[0-9A-Za-z.+-]+$ ]] && [[ "$mail_transition_target" =~ ^[0-9A-Za-z.+-]+$ ]] \
    && [[ "$mail_owner" =~ ^[a-f0-9]{48}$ ]] && contains_word "preparing activating" "$mail_transition_state" \
    || refuse "mail transition journal is malformed"
  case "$mail_transition_recovery" in
    "$installation_directory"/backups/recovery-*) ;;
    *) refuse "mail transition recovery path is invalid" ;;
  esac
  verify_recovery_unit "$mail_transition_recovery"
  validate_environment_file "$mail_journal/target.env"
  resolve_mail_store_volumes "$mail_journal/target.env"
  mail_transition_config="${config_project}_mail-config-stalwart1-$mail_owner"
  mail_transition_data="${config_project}_mail-data-stalwart1-$mail_owner"
  [ "$selected_mail_config_volume" = "$mail_transition_config" ] && [ "$selected_mail_data_volume" = "$mail_transition_data" ] \
    || refuse "mail transition journal does not identify its owned store pair"
}

restore_mail_transition_source() {
  compose_command
  start_mail_transition_source "${compose[@]}" \
    || refuse "mail transition source restart failed; recovery unit $mail_transition_recovery is ready"
  retire_mail_transition
}

abandon_mail_store_transition() {
  local confirmed=$1 journal="$installation_directory/.courtside-mail-transition"
  [ -e "$journal" ] || [ -L "$journal" ] || refuse "no interrupted mail transition to abandon"
  read_mail_transition_journal
  [ "$config_release" = "$mail_transition_source" ] \
    || refuse "cannot abandon the mail transition once release $config_release is selected; resume it with update --mail-store-transition reinitialize --yes or restore recovery unit $mail_transition_recovery"
  printf 'Plan: abandon the mail transition to %s and restart release %s with its selected mail stores\n' \
    "$mail_transition_target" "$config_release"
  printf 'retained_mail_config=%s\nretained_mail_data=%s\nretained_recovery=%s\n' \
    "$mail_transition_config" "$mail_transition_data" "$mail_transition_recovery"
  confirm "$confirmed"
  restore_mail_transition_source
  printf 'Abandoned the mail transition. Release %s remains selected; history is in %s.\n' \
    "$config_release" "$installation_directory/backups/mail-transition-$mail_owner"
}

resume_mail_store_transition() {
  local archive=$1 mode=$2 confirmed=$3
  [ "$mode" = reinitialize ] && [ "$confirmed" = true ] \
    || refuse "interrupted mail transition requires update --mail-store-transition reinitialize --yes with the same archive, or update --mail-store-transition abandon"
  read_mail_transition_journal
  [ "$mail_transition_target" = "$manifest_version" ] && [ "$mail_transition_digest" = "$manifest_sha256" ] \
    || refuse "mail transition journal does not match this target archive"
  local target=$mail_transition_target phase=$mail_transition_state recovery=$mail_transition_recovery
  local config=$mail_transition_config data=$mail_transition_data
  if [ "$config_release" = "$mail_transition_source" ]; then
    restore_mail_transition_source
    printf 'Retained the interrupted target stores. Preparing a new attempt from the original release.\n'
    return 1
  fi
  [ "$config_release" = "$target" ] && [ "$phase" = activating ] \
    || refuse "mail transition selection is inconsistent; use the complete recovery unit $recovery"
  resolve_mail_store_volumes "$installation_directory/config/.env"
  [ "$selected_mail_config_volume" = "$config" ] && [ "$selected_mail_data_volume" = "$data" ] \
    || refuse "mail transition selected stores do not match the journal"
  local name observed_owner
  prepare_docker_command
  for name in "$config" "$data"; do
    observed_owner=$("${docker_command[@]}" volume inspect "$name" --format '{{index .Labels "org.courtside.mail-transition-owner"}}') \
      || refuse "mail transition target ownership is unknown; recovery unit $recovery is ready"
    [ "$observed_owner" = "$mail_owner" ] \
      || refuse "mail transition target ownership changed; recovery unit $recovery is ready"
  done
  compose_command
  "${compose[@]}" --profile mail up -d --wait mail-certificate mail-reload \
    && "${compose[@]}" --profile mail-setup run --rm --no-deps mail-ready \
    && "${compose[@]}" up -d --wait \
    || refuse "mail transition activation failed; recovery unit $recovery is ready"
  retire_mail_transition
  printf 'Completed interrupted mail transition to %s. Recovery unit %s is retained.\n' "$target" "$recovery"
}
