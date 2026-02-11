<script>
  let { size = 32 } = $props();
</script>

<svg
  class="thinking-atom-icon shrink-0"
  width={size}
  height={size}
  viewBox="0 0 32 32"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <circle cx="16" cy="16" r="3" class="thinking-atom-nucleus" />
  <ellipse cx="16" cy="16" rx="10" ry="4" class="thinking-atom-orbit" />
  <ellipse cx="16" cy="16" rx="12" ry="5" class="thinking-atom-orbit-2" />
  <ellipse cx="16" cy="16" rx="11" ry="4.5" class="thinking-atom-orbit-3" />
</svg>
