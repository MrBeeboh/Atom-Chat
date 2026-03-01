import re

with open('src/lib/components/ChatInput.svelte', 'r') as f:
    content = f.read()

# Ensure ContextRing imported
if 'import ContextRing' not in content:
    content = content.replace('import { createEventDispatcher } from "svelte";', 'import { createEventDispatcher } from "svelte";\n  import ContextRing from "$lib/components/ContextRing.svelte";')

# Replace the chat-input-bar with chat-input-box structure
# Extract Attach button block
attach_match = re.search(r'<div class="chat-input-bar-attach">.*?</div>\n    </div>', content, re.DOTALL)
attach_html = attach_match.group(0)

# Extract Textarea block
textarea_match = re.search(r'<div class="chat-input-main">.*?</div>', content, re.DOTALL)
textarea_html = textarea_match.group(0)

# Extract Media toolbar
media_match = re.search(r'{#if onGenerateImageGrok \|\| onGenerateImageDeepSeek \|\| onGenerateVideoDeepSeek}.*?{/if}\n      {/if}', content, re.DOTALL)
if not media_match:
    media_match = re.search(r'{#if onGenerateImageGrok \|\| onGenerateImageDeepSeek \|\| onGenerateVideoDeepSeek}.*?{/if}\n    </div>\n  {/if}', content, re.DOTALL)
media_html = media_match.group(0) if media_match else ""

# Extract Mic, Web, Send
mic_match = re.search(r'<button\n    type="button"\n    class="mic-button".*?</button>', content, re.DOTALL)
mic_html = mic_match.group(0)

web_match = re.search(r'<button\n    type="button"\n    class="web-search-button".*?</button>', content, re.DOTALL)
web_html = web_match.group(0)

send_start = content.find('{#if $isStreaming && onStop}')
send_end = content.find('  {/if}\n  </div>', send_start)
send_html = content[send_start:send_end + 7]

# Let's fix Send button to be circular
send_html = send_html.replace('class="send-button"', 'class="chat-send-icon-btn"')
send_html = send_html.replace('class="send-button send-ready"', 'class="chat-send-icon-btn chat-send-ready"')
send_html = send_html.replace('Send\n      {/if}', '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>\n      {/if}')
send_html = send_html.replace('Stop</button>', '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg></button>')

# Build the new structure
new_structure = f"""
  <div class="chat-input-box" class:sending class:just-sent={{justSent}} class:send-error={{sendError}}>
    {textarea_html}
    <div class="chat-input-footer">
      <div class="chat-input-footer-icons">
        {attach_html.replace('<div class="chat-input-bar-attach">', '').replace('</div>\\n    </div>', '</div>').strip()}
        {media_html}
      </div>
      <div class="chat-input-row">
        {mic_html}
        {web_html}
        <ContextRing inline={{true}} />
        {send_html.replace('  {/if}', '{/if}').strip()}
      </div>
    </div>
  </div>
"""

# Now replace the whole chat-input-bar
start_idx = content.find('<div class="chat-input-bar"')
end_idx = content.find('  </div>\n  {#if recording}', start_idx) + 8

content = content[:start_idx] + new_structure.strip() + '\n  ' + content[end_idx:]

# Also replace CSS: chat-input-bar to chat-input-box
with open('src/lib/components/ChatInput.svelte', 'w') as f:
    f.write(content)

print("Done structural replace")
