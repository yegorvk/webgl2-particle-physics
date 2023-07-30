#version 300 es

flat out uint v_id;

uniform sampler2D particles;
uniform uvec2 grid_size;

vec4 get_particle(int id) {
    ivec2 size = textureSize(particles, 0).xy;
    ivec2 coords = ivec2(id % size.x, id / size.x);
    return texelFetch(particles, coords, 0);
}

void main() {
    vec2 particle_pos = get_particle(gl_VertexID).xy;
    vec2 bin_coords = floor((particle_pos * 0.5 + 0.5) * vec2(grid_size));

    gl_Position = vec4(bin_coords / vec2(grid_size) * 2.0 - 1.0 + 0.25 / vec2(grid_size), 0.0, 1.0);
    gl_PointSize = 1.0;
    //gl_Position = vec4(0.0, 0.0, 0.0, 1.0);

    v_id = uint(gl_VertexID);
}