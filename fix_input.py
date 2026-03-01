import re

with open('/home/mike/atom-code/src/lib/components/ChatInput.svelte', 'r') as f:
    code_content = f.read()

with open('/home/mike/atom-chat/src/lib/components/ChatInput.svelte', 'r') as f:
    chat_content = f.read()

# Grab HTML block from atom-code
# Starts with <div class="chat-input-box" and ends before voiceError
box_start = code_content.find('<div\n    class="chat-input-box"')
box_end = code_content.find('{#if voiceError}', box_start)
# We actually just want the chat-input-box div itself. 
# It closes right before {#if voiceError} in atom-code.
# Let's count divs to be safe, or just use slice
html_replacement = code_content[box_start:box_end].strip()

# Find atom-chat corresponding part
chat_box_start = chat_content.find('<div\n    class="chat-input-bar"')
chat_box_end = chat_content.find('{#if recording}', chat_box_start) # atom-chat has voice-recording-hint here, or just voiceError
if chat_box_end == -1:
    chat_box_end = chat_content.find('{#if voiceError}', chat_box_start)

# Grab CSS from atom-code
css_start = code_content.find('.chat-input-container {')
css_end = code_content.find('/* Voice recording hint */', css_start)
css_replacement = code_content[css_start:css_end].strip()

# Find atom-chat CSS corresponding part
chat_css_start = chat_content.find('.chat-input-container {')
chat_css_end = chat_content.find('.voice-recording-hint {', chat_css_start)

new_chat = chat_content[:chat_box_start] + html_replacement + '\n  ' + chat_content[chat_box_end:]

chat_css_start_new = new_chat.find('.chat-input-container {')
chat_css_end_new = new_chat.find('.voice-recording-hint {', chat_css_start_new)

if chat_css_end_new != -1:
    new_chat = new_chat[:chat_css_start_new] + css_replacement + '\n\n  ' + new_chat[chat_css_end_new:]

with open('/home/mike/atom-chat/src/lib/components/ChatInput.svelte', 'w') as f:
    f.write(new_chat)

print("Replaced!")
