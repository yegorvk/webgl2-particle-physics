extern crate core;

use std::cell::OnceCell;
use std::panic;

use log::{debug, info, Level};
use wasm_bindgen::prelude::*;
use web_sys::{HtmlCanvasElement, window};
use winit::dpi::LogicalSize;
use winit::error::OsError;
use winit::event::{Event, WindowEvent};
use winit::event_loop::{EventLoop, EventLoopBuilder, EventLoopProxy};
use winit::platform::web::WindowBuilderExtWebSys;
use winit::window::{Window, WindowBuilder};

use crate::graphics::Graphics;

mod particle;
mod graphics;

#[cfg(debug_assertions)]
const LOG_LEVEL: Level = Level::Debug;

#[cfg(not(debug_assertions))]
const LOG_LEVEL: Level = Level::Info;

#[wasm_bindgen(start)]
pub fn main() {
    panic::set_hook(Box::new(console_error_panic_hook::hook));
    console_log::init_with_level(LOG_LEVEL).expect("could not initialize logger");
    info!("Wasm successfully initialized!");
}

thread_local! {
    static APP_EVENT_LOOP: OnceCell<EventLoopProxy<AppEvent>> = OnceCell::new();
}

#[wasm_bindgen]
pub async fn run(canvas: HtmlCanvasElement, canvas_width: u32, canvas_height: u32) {
    let context = Context::new();

    APP_EVENT_LOOP.with(|app_event_loop| {
        if app_event_loop.get().is_some() {
            panic!("the application has already started.")
        }

        app_event_loop.set(context.event_loop.create_proxy()).unwrap();
    });

    let app = App::new(&context, canvas, LogicalSize::new(canvas_width, canvas_height))
        .expect("could not create application");

    app.run(context);
}

#[wasm_bindgen(js_name = "isRunning")]
pub fn is_running() -> bool {
    APP_EVENT_LOOP.with(|val| val.get().is_some())
}

#[wasm_bindgen(js_name = "handleResize")]
pub fn handle_resize(new_width: u32, new_height: u32) {
    send_user_event(AppEvent::ResizeRequested(LogicalSize::new(new_width, new_height)))
}

fn send_user_event(event: AppEvent) {
    APP_EVENT_LOOP.with(|app_event_loop| {
        app_event_loop
            .get().expect("the application has not been started")
            .send_event(event).expect("the application has been terminated");
    });
}

#[derive(Debug)]
enum AppEvent {
    ResizeRequested(LogicalSize<u32>)
}

struct Context {
    event_loop: EventLoop<AppEvent>,
}

impl Context {
    pub fn new() -> Self {
        Context {
            event_loop: EventLoopBuilder::with_user_event().build()
        }
    }
}

struct App {
    graphics: Graphics,
    window: Window,
}

impl App {
    pub fn new(context: &Context, canvas: HtmlCanvasElement, size: LogicalSize<u32>) -> anyhow::Result<App> {
        let window = App::create_window(&context.event_loop, canvas, size)?;

        Ok(App {
            graphics: Graphics::initialize_with_window(&window),
            window,
        })
    }

    pub fn run(self, context: Context) -> ! {
        let performance = window().unwrap().performance().unwrap();
        let mut last_frame_time = performance.now();

        context.event_loop.run(move |event, _, control_flow| {
            control_flow.set_poll();

            match event {
                Event::UserEvent(event) => self.handle_user_event(event),
                Event::WindowEvent {
                    event,
                    ..
                } => {
                    if !self.graphics.event(&event) {
                        match event {
                            WindowEvent::CloseRequested => control_flow.set_exit(),
                            _ => {}
                        }
                    }
                }
                Event::RedrawRequested(_) => {
                    let cur_frame_time = performance.now();
                    let delta_time = cur_frame_time - last_frame_time;
                    last_frame_time = cur_frame_time;

                    debug!("FPS (instantaneous): {}", 1000.0 / delta_time);

                    self.frame(delta_time)
                }
                Event::MainEventsCleared => self.window.request_redraw(),
                _ => {}
            }
        })
    }

    fn handle_user_event(&self, event: AppEvent) {
        match event {
            AppEvent::ResizeRequested(size) => self.window.set_inner_size(size)
        }
    }

    fn frame(&self, delta_time_ms: f64) {
        self.graphics.frame(delta_time_ms);
    }

    fn create_window(event_loop: &EventLoop<AppEvent>, canvas: HtmlCanvasElement, size: LogicalSize<u32>) -> Result<Window, OsError> {
        WindowBuilder::new()
            .with_inner_size(size)
            .with_resizable(true)
            .with_canvas(Some(canvas))
            .build(event_loop)
    }
}