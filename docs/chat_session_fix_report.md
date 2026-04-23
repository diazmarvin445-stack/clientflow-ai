# Chat Session Fix Report

## Objective
Fix Maya internal chat session behavior so conversation history is not unexpectedly cleared while the user is actively using `chat.html`.

## What Was Removed
- Removed the 1-minute inactivity auto-clear logic.
- Removed timer-based reset hooks that depended on user activity events (`click`, `keypress`) to rearm clear timers.
- Removed panel idle cleanup scheduling that could clear the chat view after inactivity windows.

## Session Persistence Behavior Now
- While the user stays on `chat.html`, the current in-memory conversation remains available and is not auto-cleared by time.
- Chat is initialized with a fresh visible session on page load.
- No timer-based session expiration is used.

## When Chat Is Cleared
Chat is cleared only in explicit lifecycle boundaries:
- **Page unload / navigation away / reload** via `beforeunload` and `pagehide` handling.
- **New page load session** starts with a clean chat panel state.
- **Manual action** with `Limpiar conversación` button in the chat toolbar.

## Safety / Compatibility Notes
- Existing send/receive message flow was preserved.
- Maya context loading logic was preserved.
- Firebase integrations remain intact (including context reads and existing history persistence utilities), while timeout-driven resets were disabled.

## Files Updated
- `chat.js`
- `chat.html`
- `docs/chat_session_fix_report.md`
