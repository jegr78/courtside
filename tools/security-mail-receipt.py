import email.policy
import email.utils
import json
import re
import sys
from datetime import datetime, timezone
from email.parser import BytesParser


def receipt(raw):
    message = BytesParser(policy=email.policy.default).parsebytes(raw)
    identifiers = message.get_all("Message-ID", [])
    if len(identifiers) != 1 or not re.fullmatch(r"<[^<>\s]+@[^<>\s]+>", str(identifiers[0])):
        raise ValueError("A captured message needs one valid Message-ID")
    calendars = [part for part in message.walk() if part.get_content_type() == "text/calendar"]
    if len(calendars) != 1:
        raise ValueError("A booking receipt needs exactly one calendar")
    calendar = calendars[0].get_payload(decode=True).decode("utf-8")
    if any(part.defects for part in message.walk()):
        raise ValueError("A booking receipt has malformed MIME content")
    calendar = re.sub(r"\r?\n[ \t]", "", calendar)
    lines = calendar.strip().splitlines()
    if not lines or lines[0] != "BEGIN:VCALENDAR" or lines[-1] != "END:VCALENDAR" \
            or lines.count("BEGIN:VEVENT") != 1 or lines.count("END:VEVENT") != 1:
        raise ValueError("A booking receipt needs one complete calendar event")
    begin = lines.index("BEGIN:VEVENT")
    end = lines.index("END:VEVENT")
    if begin >= end:
        raise ValueError("A calendar has invalid event boundaries")
    values = {}
    for index, line in enumerate(lines):
        name, separator, value = line.partition(":")
        if separator and name in ("UID", "DTSTART", "DTEND"):
            if name in values or not begin < index < end:
                raise ValueError("A calendar contains a duplicate receipt field")
            values[name] = value
    if not re.fullmatch(r"booking-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@courtside", values.get("UID", "")):
        raise ValueError("A calendar does not identify a booking")
    result = {"messageId": str(identifiers[0]), "calendarUid": values["UID"],
              "recipients": [address for _, address in email.utils.getaddresses(message.get_all("To", []))]}
    for field, target in (("DTSTART", "startsAt"), ("DTEND", "endsAt")):
        result[target] = datetime.strptime(values[field], "%Y%m%dT%H%M%SZ").replace(
            tzinfo=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if not result["recipients"] or result["endsAt"] <= result["startsAt"]:
        raise ValueError("A booking receipt has invalid recipient or time bounds")
    return result


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(262145)
        if len(raw) > 262144:
            raise ValueError("The captured message exceeds the receipt budget")
        print(json.dumps(receipt(raw), separators=(",", ":")))
    except (ValueError, KeyError, UnicodeError):
        sys.stderr.write("The captured message has invalid booking receipt data\n")
        sys.exit(1)
