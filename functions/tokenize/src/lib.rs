use anyhow::Result;
use serde::{Deserialize, Serialize};
use spin_sdk::{
    http::{Request, Response},
    http_component,
};

mod auth;
mod key_value;

mod delete;
mod get;
mod post;

#[derive(Serialize, Deserialize)]
struct Output<'a> {
    message: &'a str,
}

pub fn message(message: &str) -> Result<Option<bytes::Bytes>> {
    Ok(Some(serde_json::to_vec(&Output { message })?.into()))
}

#[http_component]
fn handler(req: Request) -> Result<Response> {
    let method = req.method();
    match auth::is_authenticated(&req)? {
        auth::AuthResult::Ok { user_id, payload } => match method.as_str() {
            "GET" => get::handler(&user_id, &payload),
            "POST" => post::handler(&user_id, &payload),
            "DELETE" => delete::handler(&user_id, &payload),
            _ => http::Response::builder()
                .status(400)
                .body(message("Only GET and POST are allowed.")?)
                .map_err(|e| e.into()),
        },
        auth::AuthResult::NoCookie => http::Response::builder()
            .status(200)
            .header(
                "Set-Cookie",
                format!("token={}; HttpOnly", &auth::get_token()),
            )
            .body(message("Cookie set.")?)
            .map_err(|e| e.into()),
        auth::AuthResult::SiteNotFound => http::Response::builder()
            .status(404)
            .body(message("Site not found.")?)
            .map_err(|e| e.into()),
        auth::AuthResult::Unauthorized => http::Response::builder()
            .status(401)
            .body(message("Unauthorized.")?)
            .map_err(|e| e.into()),
    }
}
