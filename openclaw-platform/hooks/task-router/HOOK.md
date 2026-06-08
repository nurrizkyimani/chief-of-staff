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
Normal chat returns unhandled so OpenClaw can continue its default agent flow.
