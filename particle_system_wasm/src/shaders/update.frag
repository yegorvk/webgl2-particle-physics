#version 300 es

precision highp float;
precision highp int;
precision highp usampler2DArray;

layout (location = 0) out vec4 out_particle;

uniform sampler2D particles;
uniform usampler2DArray bins;
uniform float dt;
uniform uvec2 grid_size;
uniform float particle_radius;

const uint BIN_CAPACITY = 4u;

struct Particle {
    vec2 position;
    vec2 velocity;
};

struct Bin {
    Particle particles[BIN_CAPACITY];
};

Particle load_particle(in ivec2 coords) {
    vec4 raw_particle = texelFetch(particles, coords, 0);
    return Particle(raw_particle.xy, raw_particle.zw);
}

Particle get_particle(in uint id) {
    ivec2 size = textureSize(particles, 0).xy;
    ivec2 coords = ivec2(int(id) % size.x, int(id) / size.x);
    return load_particle(coords);
}

void load_bin(in uint cur_particle_id, in uvec2 position, out Bin bin) {
    for (uint i = 0u; i < BIN_CAPACITY; ++i) {
        uint id = texelFetch(bins, ivec3(ivec2(position), int(i)), 0).x;

        if (id == 0u || id - 1u == cur_particle_id)
            bin.particles[i] = Particle(vec2(-1000.0), vec2(0.0));
        else
            bin.particles[i] = get_particle(id - 1u);
    }
}

uvec2 get_bin_coords(in vec2 position) {
    return uvec2(floor((position * 0.5 + 0.5) * vec2(grid_size)));
}

void process_collisions(inout Particle cur_particle, in Bin bin) {
    for (uint i = 0u; i < BIN_CAPACITY; ++i) {
        vec2 delta_pos = bin.particles[i].position - cur_particle.position;

        if (dot(delta_pos, delta_pos) <= 4.0 * particle_radius * particle_radius) {
            vec2 n_delta_pos = normalize(delta_pos);
            vec2 n_velocity = normalize(cur_particle.velocity);

            cur_particle.position -= max(0.0, 2.05 * particle_radius - length(delta_pos)) * (dot(n_delta_pos, n_velocity) * n_velocity);
            //cur_particle.velocity = 1.0 * -cur_particle.velocity;

            vec2 a = dot(cur_particle.velocity, n_delta_pos) * n_delta_pos;
            vec2 b = cur_particle.velocity - a;

            cur_particle.velocity = 0.8 * -a + b;

            //cur_particle.velocity -= dot(cur_particle.velocity, n_delta_pos) * n_delta_pos;

            //break;
        }
    }
}

uint get_particle_id(in ivec2 coords) {
    return uint(coords.x + coords.y * textureSize(particles, 0).x);
}

void gravity_field(inout Particle particle, vec2 center, float strength) {
    vec2 delta_pos = center - particle.position;
    particle.velocity += normalize(delta_pos) * dt * strength / max(dot(delta_pos, delta_pos), 0.0001);
}

void main() {
    uint particle_id = get_particle_id(ivec2(gl_FragCoord.xy));
    Particle particle = load_particle(ivec2(gl_FragCoord.xy));

    // Process collisions

    Bin bin;
    ivec2 bin_coords = ivec2(get_bin_coords(particle.position));

    load_bin(particle_id, uvec2(bin_coords), bin);
    process_collisions(particle, bin);

    load_bin(particle_id, uvec2(bin_coords + ivec2(1, 0)) , bin);
    process_collisions(particle, bin);

    load_bin(particle_id, uvec2(bin_coords + ivec2(-1, 0)) , bin);
    process_collisions(particle, bin);

    load_bin(particle_id, uvec2(bin_coords + ivec2(0, 1)) , bin);
    process_collisions(particle, bin);

    load_bin(particle_id, uvec2(bin_coords + ivec2(0, -1)) , bin);
    process_collisions(particle, bin);

    // Update position

    //particle.velocity -= 2.0 * vec2(lessThan(particle.position, vec2(-1.05))) * particle.velocity;
    //particle.velocity -= 2.0 * vec2(greaterThan(particle.position, vec2(1.05))) * particle.velocity;

    //particle.position.y = max(particle.position.y, -1.0);

    particle.position += dt * particle.velocity;

//    gravity_field(particle, vec2(-1.0, -1.0), 0.1);
//    gravity_field(particle, vec2(-1.0, 1.0), 0.1);
//    gravity_field(particle, vec2(1.0, -1.0), 0.1);
//    gravity_field(particle, vec2(1.0, 1.0), 0.1);

    //particle.velocity -= 0.01 * dt * particle.velocity;

    particle.velocity += dt * vec2(0.0, -9.87 / 10.0);

    out_particle = vec4(particle.position, particle.velocity);
}