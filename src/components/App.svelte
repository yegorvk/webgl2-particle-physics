<script lang="ts">
    import ParticleRenderer from "./ParticleRenderer.svelte";

    let innerWidth: number = 0;
    let innerHeight: number = 0;
</script>

<svelte:window bind:innerWidth bind:innerHeight/>

<div id="container">
    <ParticleRenderer width={innerWidth} height={innerHeight}></ParticleRenderer>
</div>

<style>
    #container {
        position: absolute;
        left: 0;
        top: 0;
        width: 1vw;
        height: 1vh;
    }
</style>
