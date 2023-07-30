#version 300 es
precision mediump float;

out vec4 out_color;

float len2(vec2 v) {
    return dot(v, v);
}

void main() {
    if (len2(2.0 * gl_PointCoord - 1.0) <= 1.0)
        out_color = vec4(1.0, 0.0, 0.0, 1.0);
    else
        discard;

//    out_color = vec4(1.0, 0.0, 0.0, 1.0);
}