#!/bin/sh
set -eu
umask 077
cs_feature_list=
cs_feature_found=0
cs_profile_dir=
cs_profile_found=0
for cs_argument do
  case "$cs_argument" in
    --disable-features=*)
      [ "$cs_feature_found" = 0 ] || exit 64
      cs_feature_list=${cs_argument#--disable-features=}
      cs_feature_found=1
      ;;
    --user-data-dir=*)
      [ "$cs_profile_found" = 0 ] || exit 64
      cs_profile_dir=${cs_argument#--user-data-dir=}
      cs_profile_found=1
      ;;
  esac
done
[ "$cs_feature_found" = 1 ] && [ "$cs_profile_found" = 1 ] || exit 64
case "$cs_profile_dir" in
  /tmp/k6browser-data-*) cs_profile_suffix=${cs_profile_dir#/tmp/k6browser-data-} ;;
  *) exit 64 ;;
esac
case "$cs_profile_suffix" in
  ''|*[!0-9]*) exit 64 ;;
esac
[ -d "$cs_profile_dir" ] && [ ! -L "$cs_profile_dir" ] || exit 64
[ "${HOME:-}" = /tmp ] || exit 64
[ ! -e /tmp/.pki/nssdb ] && [ ! -L /tmp/.pki/nssdb ] || exit 64
/bin/mkdir "$cs_profile_dir/courtside-data"
XDG_DATA_HOME="$cs_profile_dir/courtside-data"
export XDG_DATA_HOME
exec /usr/bin/chromium "$@" "--disable-features=${cs_feature_list:+$cs_feature_list,}WebUIOmniboxPopup,WebUIOmniboxAimPopup"
