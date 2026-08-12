<script>
  /** Logo size in pixels (width/height). Default 24 for headers, use larger (e.g. 32) for splash. */
  let { size = 24 } = $props();
</script>

<svg
  class="atom-logo-icon atom-logo-live shrink-0"
  viewBox="0 0 32 32"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
  role="img"
  width={size}
  height={size}>
  <circle cx="16" cy="16" r="3.5" class="atom-logo-nucleus" />
  <ellipse cx="16" cy="16" rx="12" ry="5" stroke-width="1.2" opacity="0.95" class="atom-logo-orbit atom-logo-orbit-1" />
  <ellipse cx="16" cy="16" rx="12" ry="5" stroke-width="1.2" opacity="0.9" class="atom-logo-orbit atom-logo-orbit-2" transform="rotate(60 16 16)" />
  <ellipse cx="16" cy="16" rx="12" ry="5" stroke-width="1.2" opacity="0.9" class="atom-logo-orbit atom-logo-orbit-3" transform="rotate(120 16 16)" />
</svg>
