import re

with open('/home/mike/atom-code/src/lib/components/ChatInput.svelte', 'r') as f:
    code_content = f.read()

with open('/home/mike/atom-chat/src/lib/components/ChatInput.svelte', 'r') as f:
    chat_content = f.read()

box_start = code_content.find('<div class="chat-input-box"')
if box_start == -1:
    print("Cannot find chat-input-box in atom-code")
    exit(1)

box_end = code_content.find('{#if voiceError}', box_start)
html_replacement = code_content[box_start:box_end].strip()

# In atom-chat, the box is completely gone. We need to insert it before {#if recording}
# Let's find {#if recording} in atom-chat
insert_pos = chat_content.find('{#if recording}')
if insert_pos == -1:
    print("Cannot find recording block in atom-chat")
    exit(1)

new_chat = chat_content[:insert_pos] + html_replacement + '\n\n  ' + chat_content[insert_pos:]

with open('/home/mike/atom-chat/src/lib/components/ChatInput.svelte', 'w') as f:
    f.write(new_chat)

print("Inserted correctly!")
