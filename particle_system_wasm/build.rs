use std::{env, fs};
use std::ffi::OsStr;
use std::fs::{create_dir_all, read_dir, read_to_string};
use std::path::Path;

use shaderc::{CompileOptions, Compiler, ShaderKind};

fn main() {
    println!("cargo:rerun-if-changed=src/shaders");
    build_files("./src/shaders");
}

fn build_files<P: AsRef<Path>>(dir: P) {
    let entries = read_dir(dir);

    if matches!(entries.as_ref(), Err(err) if err.kind() == std::io::ErrorKind::NotFound) {
        return
    }

    let entries = entries.unwrap()
        .filter(|entry| entry.is_ok())
        .map(|entry| entry.unwrap().path().canonicalize().unwrap())
        .filter(|path| path.file_name().is_some() && path.extension().is_some());

    let compiler = Compiler::new().unwrap();
    let options = CompileOptions::new().unwrap();

    for path in entries {
        if path.is_dir() {
            build_files(path)
        } else {
            let prefix = env::current_dir().unwrap().canonicalize().unwrap();
            assert!(path.starts_with(&prefix));

            let dir_relative = path.parent().unwrap_or(Path::new(""))
                .strip_prefix(&prefix).unwrap()
                .strip_prefix(Path::new("src/shaders")).unwrap();

            let filename = path.file_name().unwrap().to_string_lossy();
            let shader_kind = get_shader_kind(path.extension().unwrap());
            let shader_source = read_to_string(&path).unwrap();

            let artifact = compiler.compile_into_spirv(
                &shader_source,
                shader_kind,
                &filename,
                "main",
                Some(&options),
            ).expect(&format!("shader file ({}) compilation failed.", filename));

            let out_filename = (filename + ".spirv").to_string();

            let out_dir = Path::new(&env::var("OUT_DIR").unwrap())
                .join("shaders")
                .join(dir_relative);

            let out_path = out_dir.join(Path::new(&out_filename));

            create_dir_all(&out_dir).unwrap();
            fs::write(out_path, artifact.as_binary_u8()).unwrap();
        }
    }
}

fn get_shader_kind(ext: &OsStr) -> ShaderKind {
    if ext == "comp" {
        ShaderKind::Compute
    } else if ext == "vert" {
        ShaderKind::Vertex
    } else if ext == "frag" {
        ShaderKind::Fragment
    } else {
        panic!("Unrecognized shader file extension: {}", ext.to_string_lossy());
    }
}