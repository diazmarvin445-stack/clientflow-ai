# Maya Voice Input Report

## What was added

Voice-to-text microphone input was added to Maya internal chat composer in `chat.html` / `chat.js` / `styles.css`.

- New microphone button in the composer (`#yc-chat-mic`), placed between the text input and Send button.
- Browser-native speech recognition integration using:
  - `window.SpeechRecognition`
  - `window.webkitSpeechRecognition`
- Recognized speech is inserted into the input field so the user can review/edit before sending.
- Send remains manual by default.

## How microphone input works

1. User taps the microphone button.
2. Browser speech recognition starts (if supported and permitted).
3. When speech is recognized, final transcript text is appended to the current input.
4. Input stays editable, and user sends manually with the existing Send flow.

Implementation notes:

- Recognition language is set to Spanish (`es-ES`).
- Uses non-continuous capture (`continuous = false`) and final results (`interimResults = false`) for stable UX.
- UI state updates while listening (`is-listening` style + accessible labels).

## Browser support behavior

The feature checks for native support at runtime:

- Supported: uses available constructor (`SpeechRecognition` or `webkitSpeechRecognition`).
- Unsupported: microphone button stays disabled and clicking shows a simple fallback toast.

This avoids runtime errors and preserves the rest of chat behavior.

## Behavior when speech recognition is unavailable

If speech recognition is unavailable or blocked:

- Chat remains fully functional for typed messages.
- A clear toast message is shown (unsupported browser or denied microphone permission).
- No crash, no interruption to tabs/context/message sending.

## No voice output

No text-to-speech or spoken response was added.

Maya responses remain text-only in the existing chat stream.

## Future option (not enabled)

A future-ready flag exists in code:

- `MAYA_VOICE_AUTO_SEND = false`

It is intentionally disabled, so current behavior always requires manual Send.
