use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use spin_sdk::{
    http::{Request, Response},
    http_component,
};
use std::path::Path;
use std::{fs::File, io::Read};

#[http_component]
fn serve(req: Request) -> Result<Response> {
    let path = req.headers().get("spin-path-info").unwrap().to_str()?;
    let mime = guess_mime(path).expect("Couldn't get mime");

    match read(path) {
        Ok(body) => Ok(http::Response::builder()
            .status(200)
            .header("Content-Type", mime.essence_str())
            .body(Some(body))?),
        Err(err) => {
            eprintln!("Error: {}", err);
            spin_sdk::http::not_found()
        }
    }
}

fn guess_mime<T: AsRef<Path>>(path: T) -> Option<mime_guess::mime::Mime> {
    let path_ref = path.as_ref();
    if path_ref.is_dir() {
        Some(mime_guess::mime::TEXT_HTML)
    } else {
        mime_guess::from_path(path_ref).first()
    }
}

fn read<T: AsRef<Path>>(path: T) -> Result<Bytes> {
    let path = path.as_ref();
    let mut file = if path.is_dir() {
        File::open(path.join("index.html")).with_context(|| anyhow!("tried directory index"))?
    } else {
        File::open(path).with_context(|| anyhow!("cannot open"))?
    };

    let mut buf = vec![];
    file.read_to_end(&mut buf)?;

    Ok(buf.into())
}
