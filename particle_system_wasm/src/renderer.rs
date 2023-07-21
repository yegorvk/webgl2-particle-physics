use thiserror::Error;
use wgpu::{CreateSurfaceError, RequestDeviceError, SurfaceError};
use winit::event::WindowEvent;
use winit::window::Window;

#[derive(Debug, Error)]
pub enum InitializationError {
    #[error(transparent)]
    CreateSurfaceError(#[from] CreateSurfaceError),

    #[error("could not find any compatible WGPU adapter")]
    NoCompatibleAdapter,

    #[error(transparent)]
    RequestDeviceError(#[from] RequestDeviceError),
}

#[derive(Debug, Error)]
pub enum RenderingError {
    #[error(transparent)]
    SwapchainTextureAcquireError(#[from] SurfaceError)
}

pub struct Renderer {
    surface: wgpu::Surface,
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface_config: wgpu::SurfaceConfiguration,
    window: Window,
}

impl Renderer {
    pub async fn new(window: Window) -> Result<Self, InitializationError> {
        let win_size = window.inner_size();

        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            dx12_shader_compiler: Default::default(),
        });

        let surface = unsafe { instance.create_surface(&window) }?;

        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }).await.ok_or(InitializationError::NoCompatibleAdapter)?;

        let (device, queue) = adapter.request_device(
            &wgpu::DeviceDescriptor {
                features: wgpu::Features::empty(),
                limits: wgpu::Limits::downlevel_webgl2_defaults(),
                label: None,
            },
            None,
        ).await?;

        let surface_caps = surface.get_capabilities(&adapter);

        let surface_format = surface_caps.formats.iter()
            .copied()
            .find(|format| format.is_srgb())
            .unwrap_or(surface_caps.formats[0]);

        let surface_config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width: win_size.width,
            height: win_size.height,
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode: surface_caps.alpha_modes[0],
            view_formats: vec![],
        };

        surface.configure(&device, &surface_config);

        Ok(Self {
            surface,
            device,
            queue,
            surface_config,
            window,
        })
    }

    pub fn window(&self) -> &Window {
        &self.window
    }

    pub fn draw(&mut self) -> Result<(), RenderingError> {
        let output = self.surface.get_current_texture()?;
        let view = output.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());

        {
            let _render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.2,
                            g: 0.3,
                            b: 0.5,
                            a: 1.0
                        }),
                        store: true
                    }
                })],
                depth_stencil_attachment: None
            });
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        output.present();

        Ok(())
    }

    pub fn handle_win_event(&mut self, event: &WindowEvent) -> bool {
        match event {
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => self.on_resize(),
            _ => {}
        }

        false
    }

    fn on_resize(&mut self) {
        let size = self.window.inner_size();

        if size.width != self.surface_config.width || size.height != self.surface_config.height {
            self.surface_config.width = size.width;
            self.surface_config.height = size.height;
            self.surface.configure(&self.device, &self.surface_config);
        }
    }
}