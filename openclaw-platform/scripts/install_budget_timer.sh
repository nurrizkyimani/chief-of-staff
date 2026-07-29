#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/openclaw-platform}"
SERVICE_NAME="openclaw-budget-guardrail"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<SERVICE
[Unit]
Description=OpenClaw budget guardrail WhatsApp push

[Service]
Type=oneshot
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/docker compose exec -T gateway npm run budget:send
SERVICE

cat > "/etc/systemd/system/${SERVICE_NAME}.timer" <<TIMER
[Unit]
Description=Run OpenClaw budget guardrail every Monday morning

[Timer]
OnCalendar=Mon *-*-* 08:00:00
Persistent=true
Timezone=Asia/Jakarta

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.timer"
systemctl list-timers "${SERVICE_NAME}.timer"
