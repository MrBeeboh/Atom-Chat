# Voice / Microphone Issue — Handoff for Other AIs or Developers

**Goal:** Share this repo so another AI or developer can fix the microphone flow.

---

## The Problem

- **Stack:** Svelte 5 (runes: `$state`, `$effect`, `$derived`), browser **Web Speech API** only (no Whisper, no ONNX).
- **Desired behavior (always-on mic):**
  1. User clicks mic once → it turns on (green / “Listening”).
  2. User speaks → transcript appears in the chat input.
  3. User clicks Send → message is sent, input is cleared, **mic stays on**.
  4. User speaks again → new transcript appears. No need to click the mic again.
  5. Mic turns off **only** when the user clicks the mic button again.

- **Actual behavior:**  
  The **first** use works: mic on → speak → text appears → send. After the model responds, the mic **appears** on (browser may still show mic permission, UI may still say “Listening”), but **speech no longer produces any text** in the input. So the “connection” between the microphone and the chat input is lost after the first send/response cycle.

---

## What’s Been Tried (No Fix Yet)

1. **Single `ChatInput` instance**  
   The view was refactored so there is only one `ChatInput` for the conversation (no remount when switching from “empty” to “has messages”). So the same component instance is used before and after the first message.

2. **Decouple Send from mic**  
   - `handleSubmit()` does **not** call `stopVoice()` or touch the microphone.  
   - Send/Stop button does not disable the mic; mic is only disabled when `voiceState === 'starting'`.

3. **Always-on intent**  
   - `userWantsMicOn` is set when the user turns the mic on and cleared only when they turn it off (or on unmount/visibility hidden).  
   - When the browser’s `SpeechRecognition` fires `onend` (e.g. after silence), we **restart** recognition (after a 120 ms delay) if `userWantsMicOn` is still true, so the mic should stay logically “on.”

4. **Stale closure**  
   - A `textRef` object is kept in sync with the input `text` in an `$effect`.  
   - In `rec.onresult` we read `textRef.current` and write to `text` so that updates always apply to the current input, including after send (when `text` is cleared).

5. **Delayed restart**  
   - On `rec.onend`, we call `doStartVoice(SR, false, true)` inside `setTimeout(..., 120)` so the browser has time to release the previous session before starting a new one.

Despite all of this, after the first message and model response, speech still does not show up in the input. So something is still disconnecting or invalidating the link between the live `SpeechRecognition` and the visible input (e.g. browser behavior, Svelte 5 reactivity, or another side effect we haven’t found).

---

## Files in This Handoff

- **`src/lib/components/ChatInput.svelte`**  
  Full chat input component including all voice logic (toggle, `doStartVoice`, `stopVoice`, `onresult` / `onend` / `onerror`, `textRef`, always-on restart).

- **`CONTEXT.md`**  
  How `ChatInput` is used in the app (single instance in `ChatView`) and which stores it depends on (`isStreaming`, `insertIntoInput`, `insertAppend`, `settings`, etc.).

---

## How to Run the Full App (This Repo Is a Slice)

This folder is a **slice** of the real app. To run the full UI:

1. Use the parent project: `lm-studio-ui` (the repo that contains this `voice-issue-handoff` folder).
2. From the project root: `npm install` then `npm run dev`.
3. Open a conversation, click the mic, speak, send a message, wait for the model to respond, then speak again — the bug is that the second speech does not appear in the input.

---

## What Would Fix It (Hypotheses)

- **Browser:** Chrome’s `SpeechRecognition` may need a different restart strategy (e.g. full teardown and new instance after send, or different delay).  
- **Reactivity:** Something in Svelte 5 may still be batching or dropping updates from the recognition callback when they happen after a send/streaming cycle.  
- **Focus / DOM:** After send or when the Stop button is shown, something might be stealing focus or replacing DOM in a way that breaks the active recognition or the input binding.  
- **Permission / stream:** The browser might be revoking or re-binding the mic in a way we don’t see; checking `navigator.mediaDevices.getUserMedia` or recognition state after send might help.

---

## Model / Backend Note

The issue is **not** the LM model (e.g. inference-net, etc.). It’s the **frontend**: Web Speech API + Svelte 5 + the lifecycle around send/streaming. Picking a different chat model won’t fix it.

---

*Handoff generated so other AIs or developers can continue from this description and code.*
