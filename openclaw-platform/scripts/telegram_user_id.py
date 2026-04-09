#!/usr/bin/env python3

import json
import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        print("TELEGRAM_BOT_TOKEN missing in .env")
        return 1

    url = f"https://api.telegram.org/bot{token}/getUpdates"
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as error:
        print(f"Telegram API request failed: {error}")
        return 1

    if not payload.get("ok"):
        code = payload.get("error_code")
        description = payload.get("description")
        print(f"Telegram API error: {code} {description}")
        return 1

    users: list[tuple[str, str, str]] = []
    for item in payload.get("result", []):
        candidates = [
            item.get("message") or {},
            item.get("edited_message") or {},
            item.get("channel_post") or {},
            (item.get("callback_query") or {}).get("from") or {}
        ]

        for candidate in candidates:
            from_obj = candidate.get("from") if isinstance(candidate, dict) and "from" in candidate else candidate
            if not isinstance(from_obj, dict):
                continue

            uid = from_obj.get("id")
            if uid is None:
                continue

            username = from_obj.get("username") or ""
            first_name = from_obj.get("first_name") or ""
            last_name = from_obj.get("last_name") or ""
            full_name = f"{first_name} {last_name}".strip()
            row = (str(uid), username, full_name)

            if row not in users:
                users.append(row)

    if not users:
        print("No user IDs in bot updates yet. DM your bot with /start, then rerun `make telegram-user-id`.")
        return 0

    print("Found Telegram user IDs from bot updates:")
    for uid, username, full_name in users:
        print(f"{uid}\t@{username}\t{full_name}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
