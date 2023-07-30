#version 300 es

uniform sampler2D particles;
uniform float point_size;

const float PARTICLE_SCALE = 1.0;

float rand(float n) {
    return fract(sin(n) * 43758.5453123);
}

void main() {
    ivec2 size = textureSize(particles, 0).xy;
    ivec2 coords = ivec2(gl_VertexID % size.x, gl_VertexID / size.x);

    vec4 particle = texelFetch(particles, coords, 0);

    gl_Position = vec4(particle.xy, 0.0, 1.0);
    gl_PointSize = point_size;
}