use bytemuck::{Pod, Zeroable};
use glam::Vec2;
use js_sys::Math::random;

#[derive(Debug, Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct Particle {
    position: Vec2,
    velocity: Vec2,
}

const MIN_VELOCITY: f32 = -0.1;
const MAX_VELOCITY: f32 = 0.1;

pub fn generate_particles(cnt: u32, min_pos: Vec2, max_pos: Vec2) -> Vec<Particle> {
    (0..cnt).map(|_| Particle {
        position: range_random_v2(min_pos, max_pos),
        //velocity: Vec2::ZERO,
        velocity: range_random_v2(Vec2::splat(MIN_VELOCITY), Vec2::splat(MAX_VELOCITY)),
    }).collect()
}

#[inline]
fn range_random_v2(min: Vec2, max: Vec2) -> Vec2 {
    Vec2 {
        x: range_random(min.x, max.x),
        y: range_random(min.y, max.y),
    }
}

#[inline]
fn range_random(min: f32, max: f32) -> f32 {
    (random() as f32) * (max - min) + min
}