#version 300 es

precision highp int;
precision highp float;
precision highp usampler2DArray;

flat in uint v_id;

uniform uint pass;
uniform usampler2DArray bins;

layout (location = 0) out uint out_id;

uvec4 encode_uint(uint val) {
    return uvec4((val >> 24u) & 0xFFu, (val >> 16u) & 0xFFu, (val >> 8u) & 0xFFu, val & 0xFFu);
}

void main() {
    ivec2 bin_coords = ivec2(gl_FragCoord.xy - vec2(0.5));
    int prev_id = 1000 * 1000 * 1000;

    if (pass > 0u)
        prev_id = int(texelFetch(bins, ivec3(bin_coords, int(pass) - 1), 0).r);

    if (int(v_id) < prev_id - 1)
        out_id = v_id + 1u;
    else
        discard;
}