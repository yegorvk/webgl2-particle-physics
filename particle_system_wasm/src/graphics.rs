use std::cell::RefCell;
use std::cmp::min;
use std::mem;
use std::rc::Rc;

use glam::Vec2;
use js_sys::{Float32Array, Object};
use log::debug;
use web_sys::{WebGl2RenderingContext, WebGlTexture};
use winit::dpi::PhysicalSize;
use winit::event::WindowEvent;
use winit::platform::web::WindowExtWebSys;
use winit::window::Window;
use wrend::{FramebufferCreateContext, FramebufferLink, Id, IdDefault, IdName, ProgramLink, RendererData, TextureCreateContext, TextureLink, UniformContext, UniformLink};

use crate::particle::generate_particles;

type GL = WebGl2RenderingContext;

const DRAW_VERTEX: &'static str = include_str!("shaders/draw.vert");
const DRAW_FRAGMENT: &'static str = include_str!("shaders/draw.frag");

const UPDATE_VERTEX: &'static str = include_str!("shaders/update.vert");
const UPDATE_FRAGMENT: &'static str = include_str!("shaders/update.frag");

const PARTITION_VERTEX: &'static str = include_str!("shaders/partition.vert");
const PARTITION_FRAGMENT: &'static str = include_str!("shaders/partition.frag");

const PARTICLE_COUNT_SQRT: u32 = 300;
const PARTICLE_COUNT: u32 = PARTICLE_COUNT_SQRT * PARTICLE_COUNT_SQRT;

const DATA_TEXTURE_WIDTH: u32 = PARTICLE_COUNT_SQRT;
const DATA_TEXTURE_HEIGHT: u32 = PARTICLE_COUNT_SQRT;

const GRID_ROWS: u32 = 128;
const GRID_COLUMNS: u32 = 128;

const BIN_CAPACITY: u32 = 4;

const PARTICLE_RADIUS: f32 = 0.00144675925;
const PARTICLE_SCALE: f32 = 1.0;
const PARTICLE_RADIUS_SCALED: f32 = (PARTICLE_RADIUS as f64 * PARTICLE_SCALE as f64) as f32;

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
enum VertexShaderId {
    Draw,
    Update,
    Partition,
}

impl Default for VertexShaderId {
    fn default() -> Self {
        Self::Draw
    }
}

impl Id for VertexShaderId {}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
enum FragmentShaderId {
    Draw,
    Update,
    Partition,
}

impl Default for FragmentShaderId {
    fn default() -> Self {
        Self::Draw
    }
}

impl Id for FragmentShaderId {}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
enum ProgramId {
    Draw,
    Update,
    Partition,
}

impl Default for ProgramId {
    fn default() -> Self {
        Self::Draw
    }
}

impl Id for ProgramId {}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
enum TextureId {
    OldData,
    NewData,
    Bins,
    PartitionIntermediate,
}

impl Default for TextureId {
    fn default() -> Self {
        TextureId::OldData
    }
}

impl Id for TextureId {}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
enum FramebufferId {
    Partition,
    Update,
}

impl Default for FramebufferId {
    fn default() -> Self {
        Self::Update
    }
}

impl Id for FramebufferId {}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
enum UniformId {
    DeltaTime
}

impl Default for UniformId {
    fn default() -> Self {
        Self::DeltaTime
    }
}

impl Id for UniformId {}

impl IdName for UniformId {
    fn name(&self) -> String {
        match self {
            Self::DeltaTime => "dt"
        }.to_owned()
    }
}

type AppRenderData = RendererData<
    VertexShaderId,
    FragmentShaderId,
    ProgramId,
    UniformId,
    IdDefault,
    IdDefault,
    TextureId,
    FramebufferId,
    IdDefault,
    IdDefault,
    Rc<RefCell<RenderState>>
>;

#[derive(Debug, Clone)]
struct RenderState {
    delta_time_ms: f64,
    particle_count: u32,
    odd_frame: bool,
}

impl RenderState {
    fn new(particle_count: u32) -> Self {
        RenderState {
            delta_time_ms: 0f64,
            particle_count,
            odd_frame: true,
        }
    }
}

pub struct Graphics {
    render_data: AppRenderData,
}

impl Graphics {
    pub fn initialize_with_window(window: &Window) -> Self {
        let particles = generate_particles(
            PARTICLE_COUNT,
            Vec2::splat(-1.0),
            Vec2::splat(1.0),
        );

        let particle_count = particles.len() as u32;

        let state = Rc::new(RefCell::new(RenderState::new(particle_count)));

        let canvas = window.canvas();

        let draw_program_link = ProgramLink::new(
            ProgramId::Draw,
            VertexShaderId::Draw,
            FragmentShaderId::Draw,
        );

        let update_program_link = ProgramLink::new(
            ProgramId::Update,
            VertexShaderId::Update,
            FragmentShaderId::Update,
        );

        let partition_program_link = ProgramLink::new(
            ProgramId::Partition,
            VertexShaderId::Partition,
            FragmentShaderId::Partition,
        );

        let old_data_link = TextureLink::new(
            TextureId::OldData,
            move |ctx: &TextureCreateContext| {
                create_data_texture_float32_4(
                    ctx,
                    DATA_TEXTURE_WIDTH,
                    DATA_TEXTURE_HEIGHT,
                    Some(bytemuck::cast_slice(particles.as_ref())),
                )
            },
        );

        let new_data_link = TextureLink::new(
            TextureId::NewData,
            |ctx: &TextureCreateContext| {
                create_data_texture_float32_4(
                    ctx,
                    DATA_TEXTURE_WIDTH,
                    DATA_TEXTURE_HEIGHT,
                    None,
                )
            },
        );

        let bins_link = TextureLink::new(
            TextureId::Bins,
            |ctx: &TextureCreateContext| create_data_texture_array_ui32_1(
                ctx,
                GRID_COLUMNS,
                GRID_ROWS,
                BIN_CAPACITY,
            ),
        );

        let partition_intermediate_link = TextureLink::new(
            TextureId::PartitionIntermediate,
            |ctx: &TextureCreateContext| create_data_texture_integer(
                ctx,
                GRID_COLUMNS,
                GRID_ROWS,
            ),
        );

        let update_fb_link = FramebufferLink::new(
            FramebufferId::Update,
            |ctx: &FramebufferCreateContext| ctx.gl().create_framebuffer().unwrap(),
            None,
        );

        let binning_fb_link = FramebufferLink::new(
            FramebufferId::Partition,
            |ctx: &FramebufferCreateContext| {
                let gl = ctx.gl();

                let fb = gl.create_framebuffer()
                    .unwrap();

                gl.bind_framebuffer(GL::FRAMEBUFFER, Some(&fb));

                // let depth_rb = gl.create_renderbuffer()
                //     .unwrap();
                //
                // gl.bind_renderbuffer(
                //     GL::RENDERBUFFER,
                //     Some(&depth_rb),
                // );
                //
                // gl.renderbuffer_storage(
                //     GL::RENDERBUFFER,
                //     GL::DEPTH_COMPONENT24,
                //     GRID_ROWS as i32,
                //     GRID_COLUMNS as i32,
                // );
                //
                // gl.framebuffer_renderbuffer(
                //     GL::FRAMEBUFFER,
                //     GL::DEPTH_ATTACHMENT,
                //     GL::RENDERBUFFER,
                //     Some(&depth_rb),
                // );
                //
                // gl.bind_framebuffer(GL::FRAMEBUFFER, None);

                fb
            },
            None,
        );

        let mut delta_time_link = {
            let state = state.clone();

            UniformLink::new(
                ProgramId::Update,
                UniformId::DeltaTime,
                move |ctx: &UniformContext| {
                    let gl = ctx.gl();

                    gl.uniform1f(
                        Some(ctx.uniform_location()),
                        (state.borrow().delta_time_ms / 1000.0) as f32,
                    );
                },
            )
        };

        delta_time_link.set_use_init_callback_for_update(true);

        let mut render_data_builder = RendererData::builder();

        render_data_builder
            .set_canvas(canvas)
            .set_user_ctx(state)
            .add_vertex_shader_src(VertexShaderId::Draw, DRAW_VERTEX)
            .add_fragment_shader_src(FragmentShaderId::Draw, DRAW_FRAGMENT)
            .add_vertex_shader_src(VertexShaderId::Update, UPDATE_VERTEX)
            .add_fragment_shader_src(FragmentShaderId::Update, UPDATE_FRAGMENT)
            .add_vertex_shader_src(VertexShaderId::Partition, PARTITION_VERTEX)
            .add_fragment_shader_src(FragmentShaderId::Partition, PARTITION_FRAGMENT)
            .add_program_link(draw_program_link)
            .add_program_link(update_program_link)
            .add_program_link(partition_program_link)
            .add_uniform_link(delta_time_link)
            .add_texture_link(old_data_link)
            .add_texture_link(new_data_link)
            .add_texture_link(partition_intermediate_link)
            .add_texture_link(bins_link)
            .add_framebuffer_link(update_fb_link)
            .add_framebuffer_link(binning_fb_link)
            .set_render_callback(Graphics::render_callback);

        let render_data = render_data_builder.build_renderer_data().unwrap();

        let gl = render_data.gl();

        gl.get_extension("EXT_color_buffer_float")
            .unwrap();

        gl.clear_depth(1.0);
        gl.clear_color(0.0, 0.0, 0.0, 1.0);

        gl.depth_func(GL::LESS);

        Self {
            render_data
        }
    }

    pub fn frame(&self, delta_time_ms: f64) {
        debug!("Time elapsed since previous frame (ms): {}", delta_time_ms);

        self.update(delta_time_ms);
        self.render_data.render();
    }

    pub fn event(&self, event: &WindowEvent) -> bool {
        match event {
            WindowEvent::Resized(new_size) => self.on_resize(*new_size),
            WindowEvent::ScaleFactorChanged { new_inner_size, .. } =>
                self.on_resize(**new_inner_size),
            _ => {}
        }

        false
    }

    fn update(&self, delta_time_ms: f64) {
        {
            let mut ctx = self.render_data.user_ctx()
                .unwrap().borrow_mut();

            ctx.delta_time_ms = delta_time_ms;
            ctx.odd_frame = !ctx.odd_frame;
        }

        self.render_data.update_uniforms();
    }

    fn render_callback(render_data: &AppRenderData) {
        let gl = render_data.gl();

        let state = render_data.user_ctx()
            .unwrap()
            .borrow();

        let update_fb = render_data.framebuffer(&FramebufferId::Update)
            .unwrap()
            .webgl_framebuffer();

        let binning_fb = render_data.framebuffer(&FramebufferId::Partition)
            .unwrap()
            .webgl_framebuffer();

        let mut old_data_texture = render_data.texture(&TextureId::OldData)
            .unwrap()
            .webgl_texture();

        let mut new_data_texture = render_data.texture(&TextureId::NewData)
            .unwrap()
            .webgl_texture();

        let bins_texture = render_data.texture(&TextureId::Bins)
            .unwrap()
            .webgl_texture();

        let partition_intermediate_texture = render_data.texture(&TextureId::PartitionIntermediate)
            .unwrap()
            .webgl_texture();

        if state.odd_frame {
            mem::swap(&mut old_data_texture, &mut new_data_texture);
        }

        bind_texture(gl, 0, &old_data_texture, GL::TEXTURE_2D);
        bind_texture(gl, 1, &bins_texture, GL::TEXTURE_2D_ARRAY);

        gl.enable(GL::BLEND);
        gl.blend_func(GL::ONE, GL::ONE);

        // Draw pass

        gl.bind_framebuffer(GL::FRAMEBUFFER, None);

        gl.viewport(
            0,
            0,
            render_data.canvas().width() as i32,
            render_data.canvas().height() as i32,
        );

        gl.clear(GL::COLOR_BUFFER_BIT);

        render_data.use_program(&ProgramId::Draw);

        let draw_program = render_data.program(&ProgramId::Draw)
            .unwrap();

        let pixel_size = (1.0 / render_data.canvas().width() as f32).min(
            1.0 / render_data.canvas().height() as f32
        );

        gl.uniform1f(
            Some(
                &gl.get_uniform_location(draw_program, "point_size").unwrap()
            ),
            PARTICLE_RADIUS_SCALED / pixel_size
        );

        gl.draw_arrays(GL::POINTS, 0, state.particle_count as i32);

        gl.disable(GL::BLEND);

        // Binning pass

        gl.bind_framebuffer(GL::FRAMEBUFFER, Some(&binning_fb));
        gl.viewport(0, 0, GRID_COLUMNS as i32, GRID_ROWS as i32);

        render_data.use_program(&ProgramId::Partition);

        let partition_program = render_data.program(&ProgramId::Partition)
            .unwrap();

        let pass_uniform_loc = gl.get_uniform_location(
            partition_program,
            "pass",
        ).unwrap();

        gl.uniform2ui(
            Some(
                &gl.get_uniform_location(partition_program, "grid_size").unwrap()
            ),
            GRID_COLUMNS,
            GRID_ROWS,
        );

        gl.uniform1i(
            Some(
                &gl.get_uniform_location(partition_program, "particles").unwrap()
            ),
            0,
        );

        gl.uniform1i(
            Some(
                &gl.get_uniform_location(partition_program, "bins").unwrap()
            ),
            1,
        );

        gl.framebuffer_texture_2d(
            GL::FRAMEBUFFER,
            GL::COLOR_ATTACHMENT0,
            GL::TEXTURE_2D,
            Some(partition_intermediate_texture),
            0,
        );

        gl.active_texture(GL::TEXTURE1);
        gl.read_buffer(GL::COLOR_ATTACHMENT0);

        for i in 0..BIN_CAPACITY {
            gl.clear_bufferuiv_with_u32_array(GL::COLOR, 0, &[0, 0, 0, 0]);

            gl.uniform1ui(Some(&pass_uniform_loc), i);

            gl.draw_arrays(GL::POINTS, 0, PARTICLE_COUNT as i32);

            gl.copy_tex_sub_image_3d(
                GL::TEXTURE_2D_ARRAY,
                0,
                0,
                0,
                i as i32,
                0,
                0,
                GRID_COLUMNS as i32,
                GRID_ROWS as i32,
            );
        };

        gl.read_buffer(GL::NONE);

        // Update pass

        gl.bind_framebuffer(GL::FRAMEBUFFER, Some(update_fb));
        gl.viewport(0, 0, PARTICLE_COUNT_SQRT as i32, PARTICLE_COUNT_SQRT as i32);

        gl.framebuffer_texture_2d(
            GL::FRAMEBUFFER,
            GL::COLOR_ATTACHMENT0,
            GL::TEXTURE_2D,
            Some(new_data_texture),
            0,
        );

        let update_program = render_data.program(&ProgramId::Update)
            .unwrap();

        render_data.use_program(&ProgramId::Update);

        gl.uniform1i(
            Some(
                &gl.get_uniform_location(update_program, "bins").unwrap()
            ),
            1,
        );

        gl.uniform2ui(
            Some(
                &gl.get_uniform_location(update_program, "grid_size").unwrap()
            ),
            GRID_COLUMNS,
            GRID_ROWS,
        );

        gl.uniform1f(
            Some(
                &gl.get_uniform_location(update_program, "particle_radius").unwrap()
            ),
            PARTICLE_RADIUS_SCALED,
        );

        gl.clear(GL::COLOR_BUFFER_BIT);

        gl.draw_arrays(GL::TRIANGLES, 0, 3);

        gl.bind_framebuffer(GL::FRAMEBUFFER, None);
    }

    fn on_resize(&self, new_size: PhysicalSize<u32>) {
        debug!("New WebGL viewport size: [{}, {}]", new_size.width, new_size.height);

        self.render_data.gl()
            .viewport(0, 0, new_size.width as i32, new_size.height as i32);
    }
}

fn create_data_texture_float32_4(ctx: &TextureCreateContext, width: u32, height: u32, data: Option<&[f32]>) -> WebGlTexture {
    let gl = ctx.gl();

    let texture = gl.create_texture().unwrap();

    bind_texture(gl, 0, &texture, GL::TEXTURE_2D);
    set_unfiltered_texture_params(gl, GL::TEXTURE_2D);

    let data_view = data.map(|data| unsafe { Float32Array::view(data) });
    let data_view_obj = data_view.map(|data| Object::from(data));

    gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_array_buffer_view(
        GL::TEXTURE_2D,
        0,
        GL::RGBA32F as i32,
        width as i32,
        height as i32,
        0,
        GL::RGBA,
        GL::FLOAT,
        data_view_obj.as_ref(),
    ).unwrap();

    texture
}

fn create_data_texture_integer(ctx: &TextureCreateContext, width: u32, height: u32) -> WebGlTexture {
    let gl = ctx.gl();

    let texture = gl.create_texture().unwrap();

    bind_texture(gl, 0, &texture, GL::TEXTURE_2D);
    set_unfiltered_texture_params(gl, GL::TEXTURE_2D);

    gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
        GL::TEXTURE_2D,
        0,
        GL::R32UI as i32,
        width as i32,
        height as i32,
        0,
        GL::RED_INTEGER,
        GL::UNSIGNED_INT,
        None,
    ).unwrap();

    texture
}

fn create_data_texture_array_ui32_1(ctx: &TextureCreateContext, width: u32, height: u32, layers: u32) -> WebGlTexture {
    let gl = ctx.gl();

    let texture = gl.create_texture().unwrap();

    bind_texture(gl, 0, &texture, GL::TEXTURE_2D_ARRAY);
    set_unfiltered_texture_params(gl, GL::TEXTURE_2D_ARRAY);

    gl.tex_image_3d_with_opt_u8_array(
        GL::TEXTURE_2D_ARRAY,
        0,
        GL::R32UI as i32,
        width as i32,
        height as i32,
        layers as i32,
        0,
        GL::RED_INTEGER,
        GL::UNSIGNED_INT,
        None,
    ).unwrap();

    texture
}

fn bind_texture(gl: &GL, slot: u32, texture: &WebGlTexture, target: u32) {
    gl.active_texture(GL::TEXTURE0 + slot);
    gl.bind_texture(target, Some(&texture));
}

fn set_unfiltered_texture_params(gl: &GL, target: u32) {
    gl.tex_parameteri(
        target,
        GL::TEXTURE_WRAP_S,
        GL::CLAMP_TO_EDGE as i32,
    );

    gl.tex_parameteri(
        target,
        GL::TEXTURE_WRAP_T,
        GL::CLAMP_TO_EDGE as i32,
    );

    gl.tex_parameteri(
        target,
        GL::TEXTURE_WRAP_R,
        GL::CLAMP_TO_EDGE as i32,
    );

    gl.tex_parameteri(
        target,
        GL::TEXTURE_MIN_FILTER,
        GL::NEAREST as i32,
    );

    gl.tex_parameteri(
        target,
        GL::TEXTURE_MAG_FILTER,
        GL::NEAREST as i32,
    );
}