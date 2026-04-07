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
  role="img"
  aria-label="ATOM Logo"
>
  <!-- Nucleus: small glowing center dot -->
  <circle cx="16" cy="16" r="2" class="thinking-atom-nucleus" />
  <!-- 3 orbital rings: perfect circles, non-overlapping radii -->
  <circle cx="16" cy="16" r="6" class="thinking-atom-orbit" />
  <circle cx="16" cy="16" r="9" class="thinking-atom-orbit-2" />
  <circle cx="16" cy="16" r="12" class="thinking-atom-orbit-3" />
</svg>
