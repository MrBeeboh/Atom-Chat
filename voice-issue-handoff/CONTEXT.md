# Context: How ChatInput and Voice Are Wired

## Where ChatInput Lives

- **Parent:** `src/lib/components/ChatView.svelte`
- **Usage:** Exactly **one** `<ChatInput>` is rendered when there is an active conversation (`convId`). It sits in a fixed bottom section; the content above it switches between “empty state” (greeting + suggestions) and “has messages” (toolbar + message list). So the same `ChatInput` instance is used before and after the first message — it does not remount.

Example structure in ChatView:

```svelte
{#if convId}
  {#if $activeMessages.length === 0}
    <!-- empty state: greeting + suggestion pills, no input here -->
  {:else}
    <!-- toolbar + MessageList -->
  {/if}
  <!-- Single ChatInput for both states -->
  <div class="shrink-0 border-t ...">
    <ChatInput
      onSend={sendUserMessage}
      onStop={() => abortController?.abort()}
      onSearchWeb={runWebSearch} />
  </div>
{:else}
  <!-- no conversation selected -->
{/if}
```

## Store Dependencies (from $lib/stores.js)

ChatInput uses:

- `isStreaming` — true while the model is generating a response (Send button becomes Stop).
- `insertIntoInput` — set by parent to prefill the input (e.g. from suggestion pills).
- `insertAppend` — set by parent to append text (e.g. “Quick” chips).
- `suggestionExpanded`, `webSearchForNextMessage`, `webSearchInProgress`, `settings`, `effectiveModelId` — for UI and behavior.

None of these are used to stop or start the microphone; they were intentionally kept separate from voice.

## Props

- `onSend(text, imageUrls)` — called when the user sends a message. Does not touch the mic.
- `onStop()` — called when the user clicks Stop during streaming. Does not touch the mic.
- `onSearchWeb(text)` — optional; used when “web search” is toggled for the next message.

## Audio

ChatInput also imports `$lib/audio.js` (`playClick`, `playSend`) and `$lib/fileHandler.js` for attachments. Voice logic does not depend on them; they are for UI sounds and file handling.
