---
name: task-router
description: "Route deterministic task commands before default OpenClaw chat"
metadata:
  openclaw:
    emoji: "🧭"
    events: ["message:preprocessed"]
---

# Task Router Hook

Generic OpenClaw hook for deterministic task commands such as `/receipt`, `/income`, and `/gym`.
Routing policy is configured in `config/channel-routing.json`.
Chats without `general-chat` enabled suppress the default OpenClaw agent and route media to receipt intake.
Chats with `general-chat` enabled can use it as the fallback for unknown text.
