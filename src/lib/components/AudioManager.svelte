<script>
  import { onMount } from 'svelte';
  import { primeAudio } from '$lib/audio.js';

  onMount(() => {
    const prime = () => primeAudio();
    window.addEventListener('pointerdown', prime, { passive: true });
    window.addEventListener('keydown', prime);
    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  });
</script>
