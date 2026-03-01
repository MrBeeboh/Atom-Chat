import re

with open('src/lib/components/ChatInput.svelte', 'r') as f:
    content = f.read()

# Extract the Media Toolbar block (Images/Video)
media_match = re.search(r'{#if onGenerateImageGrok \|\| onGenerateImageDeepSeek \|\| onGenerateVideoDeepSeek}.*?{/if}\n      </div>\n    {/if}', content, re.DOTALL)
if media_match:
    media_html = media_match.group(0)
    # Remove it from its original position
    content = content.replace(media_html, '')

# Extract the Mic button
mic_match = re.search(r'<button\n      type="button"\n      class="mic-button".*?</button>', content, re.DOTALL)
mic_html = mic_match.group(0)

# Extract the Web button
web_match = re.search(r'<button\n      type="button"\n      class="web-search-button".*?</button>', content, re.DOTALL)
web_html = web_match.group(0)

# Build the new grouped structure: Web Search, Mic, Image, Video
grouped_html = f"""
    <div class="chat-input-actions-group" style="display: flex; align-items: center; gap: 4px; margin-right: 8px;">
      {web_html.strip()}
      {mic_html.strip()}
      {media_html.strip()}
    </div>
"""

# Replace the original mic and web buttons with the consolidated group
# First find the ContextRing injection point
ring_match = re.search(r'<ContextRing inline={true} />', content)

if ring_match:
    # Remove old mic and web buttons
    content = content.replace(mic_html, '')
    content = content.replace(web_html, '')
    
    # Inject the grouped_html right before ContextRing
    content = content.replace('<ContextRing inline={true} />', f'{grouped_html}\n    <ContextRing inline={{true}} />')
else:
    print("Could not find ContextRing to anchor the injection")

with open('src/lib/components/ChatInput.svelte', 'w') as f:
    f.write(content)

print("Icons grouped and ordered successfully")
