<script setup lang="ts">
defineProps<{
  balanced?: boolean;
  full?: boolean;
}>();
</script>

<template>
  <div
    class="center-frame-row"
    :class="{
      'center-frame-row--balanced': balanced,
      'center-frame-row--full': full,
    }"
  >
    <slot />
  </div>
</template>
