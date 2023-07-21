#version 300 es

layout (location = 0) in vec4 xyuv;

out vec2 vUv;

uniform mat4 mvp;

void main() {
    vUv = xyuv.zw;
    gl_Position = vec4(xyuv.xy, 0.0, 1.0) * mvp;
}