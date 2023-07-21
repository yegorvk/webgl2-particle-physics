<script lang="ts">
    import {onDestroy, onMount} from "svelte";
    import {run, handleResize, isRunning} from '../wasm'

    export let width: number = 0;
    export let height: number = 0;

    let canvas: HTMLCanvasElement;

    let initialized = false;

    $: {
        if (initialized && isRunning())
            handleResize(width, height);
        else if (initialized && width > 0 && height > 0) {
            run(canvas, width, height);
        }
    }

    onMount(() => {
        initialized = true;
    });

    onDestroy(() => {
        initialized = false;
    });

</script>

<canvas bind:this={canvas}></canvas>

<style>
    canvas {
        display: block;
        background-color: black;
    }
</style>