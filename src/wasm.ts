import init_wasm from '../particle_system_wasm/pkg/particle_system_wasm';
import wasm from '../particle_system_wasm/pkg/particle_system_wasm_bg.wasm';

// @ts-ignore
await init_wasm(await wasm());

export * from '../particle_system_wasm/pkg/particle_system_wasm';