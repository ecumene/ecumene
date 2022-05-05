use anyhow::{anyhow, Result};
use cookie::Cookie;
use serde::{Deserialize, Serialize};
use spin_sdk::{
    http::{internal_server_error, Request, Response},
    http_component, redis,
};
use uuid::Uuid;

const HELP: &str = r"mitchellhynes.com - API
---
GET /        # You are here
POST /likes  # Post with an empty body for a Set-Cookie, and post with a valid
             # cookie and page to like a page. {'page_id': [id] }
";

const REDIS_ADDRESS_ENV: &str = "REDIS_ADDRESS";
const REDIS_CHANNEL_ENV: &str = "REDIS_CHANNEL";

#[derive(Serialize, Deserialize)]
struct Payload<'a> {
    page_id: &'a str,
}

fn value_contains_uuid(value: &[u8], uuid: &[u8]) -> bool {
    value.chunks(37).any(|chunk| {
        uuid.iter()
            .zip(chunk.iter())
            .any(|(value1, value2)| value1 == value2)
    })
}

fn get_links<T: AsRef<[u8]>>(source: T) -> Vec<String> {
    let mut out = vec![];
    let mut iter = source.as_ref().windows(5);

    while let Some(slice) = iter.next() {
        if "<loc>".as_bytes() == slice {
            iter.next();
            iter.next();
            iter.next();
            iter.next();
            let mut string = vec![];
            'inner: for slice in iter.by_ref() {
                if "</loc".as_bytes() == slice {
                    break 'inner;
                }
                string.push(slice[0]);
            }
            out.push(
                std::str::from_utf8(&string)
                    .expect("That's not UTF8, Piotr.")
                    .to_owned(),
            );
        }
    }

    out
}

fn get_sitemap() -> Vec<String> {
    let res = spin_sdk::outbound_http::send_request(
        http::Request::builder()
            .method("GET")
            .uri("https://mitchellhynes.com/sitemap.xml")
            .body(None)
            .expect("Sitemap: Request build error."),
    )
    .expect("Sitemap: Network error.");

    get_links(res.body().as_ref().expect("Sitemap: Empty body."))
}

fn handle_post(req: Request) -> Result<Response> {
    let address = std::env::var(REDIS_ADDRESS_ENV)?;
    let channel = std::env::var(REDIS_CHANNEL_ENV)?;
    let headers = req.headers();
    let body = req.body();
    if let Some(cookie_str) = headers.get("cookie") {
        if let Some(body_str) = body {
            let body_parsed = std::str::from_utf8(body_str)?;
            let cookie = Cookie::parse(cookie_str.to_str()?)?;
            let (key, value) = cookie.name_value();
            if key == "token" {
                let payload: Payload = serde_json::from_str(body_parsed)?;

                let mut previous = redis::get(&address, payload.page_id).unwrap_or_default();

                if value_contains_uuid(&previous, value.as_bytes()) {
                    return http::Response::builder()
                        .status(400)
                        .body(Some("Already liked.".into()))
                        .map_err(|e| e.into());
                }

                let mut new_value = value.as_bytes().to_vec().clone();
                new_value.push(b','); // uuid,uuid,uuid,
                previous.extend(new_value);

                redis::set(&address, payload.page_id, &previous)
                    .map_err(|_| anyhow!("Error executing Redis command"))?;

                let payload =
                    redis::get(&address, value).map_err(|_| anyhow!("Error querying Redis"))?;

                match redis::publish(&address, &channel, &payload) {
                    Ok(()) => Ok(http::Response::builder().status(200).body(None)?),
                    Err(_e) => internal_server_error(),
                }
            } else {
                http::Response::builder()
                    .status(400)
                    .body(Some("Missing payload.".into()))
                    .map_err(|e| e.into())
            }
        } else {
            http::Response::builder()
                .status(400)
                .body(Some("Missing cookie.".into()))
                .map_err(|e| e.into())
        }
    } else {
        let id = Uuid::new_v4();
        redis::set(&address, &id.to_string(), &[0])
            .map_err(|_| anyhow!("Error executing Redis command"))?;
        http::Response::builder()
            .status(200)
            .header("Set-Cookie", format!("token={}; HttpOnly", id))
            .body(Some("Cookie set.".into()))
            .map_err(|e| e.into())
    }
}

fn handle_get() -> Result<Response> {
    http::Response::builder()
        .status(400)
        .body(Some(format!("{:?}", get_sitemap()[0]).into()))
        .map_err(|e| e.into())
}

/// A simple Spin HTTP component.
#[http_component]
fn hello_world(req: Request) -> Result<Response> {
    if req.method() == "GET" {
        handle_get()
    } else if req.method() == "POST" {
        handle_post(req)
    } else {
        http::Response::builder()
            .status(400)
            .body(Some("Only GET and POST are allowed.".into()))
            .map_err(|e| e.into())
    }
}
