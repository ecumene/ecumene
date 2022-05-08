use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use spin_sdk::{
    http::{Request, Response},
    http_component,
};
use std::path::Path;
use std::{fs::File, io::Read};

/// A Spin HTTP component that reads and returns a static asset.
#[http_component]
fn serve(req: Request) -> Result<Response> {
    let path = req.headers().get("spin-path-info").unwrap().to_str()?;

    match read(path) {
        Ok(body) => Ok(http::Response::builder().status(200).body(Some(body))?),
        Err(err) => {
            eprintln!("Error: {}", err);
            spin_sdk::http::not_found()
        }
    }
}

/// Open the file given its path and return its content.
fn read(path: &str) -> Result<Bytes> {
    let path_obj = Path::new(path);
    let mut file = if path_obj.is_dir() {
        File::open(path_obj.join("index.html"))
            .with_context(|| anyhow!("tried directory index {}", path))?
    } else {
        File::open(path_obj).with_context(|| anyhow!("cannot open {}", path))?
    };

    let mut buf = vec![];
    file.read_to_end(&mut buf)?;

    Ok(buf.into())
}
