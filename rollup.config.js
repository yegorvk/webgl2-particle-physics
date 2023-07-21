import typescript from "@rollup/plugin-typescript";
import wasm from "@rollup/plugin-wasm";
import resolve from "@rollup/plugin-node-resolve";
import serve from "rollup-plugin-serve";
import livereload from "rollup-plugin-livereload";
import svelte from "rollup-plugin-svelte";
import commonjs from "@rollup/plugin-commonjs";
import css from "rollup-plugin-css-only";
import sveltePreprocess from "svelte-preprocess";

const production = !process.env.ROLLUP_WATCH;

export default {
    input: "src/index.ts",
    output: {
        dir: './public/generated',
        format: "es",
        sourcemap: true,
        entryFileNames: 'bundle.js'
    },
    plugins: [
        typescript({
            sourceMap: !production,
            inlineSources: !production
        }),
        wasm({
            publicPath: 'generated/'
        }),
        resolve({
            browser: true,
            dedupe: ['svelte']
        }),
        commonjs(),
        css({
            output: "bundle.css"
        }),
        svelte({
            emitCss: true,
            preprocess: sveltePreprocess({
                sourceMap: !production
            }),
            compilerOptions: {
                dev: !production
            },
        }),
        !production && serve('./public'),
        !production && livereload('./public')
    ]
}