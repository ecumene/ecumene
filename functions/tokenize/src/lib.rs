use anyhow::{anyhow, Result};
use tokenize::{get_token, with_authentication};

use serde::{Deserialize, Serialize};
use spin_sdk::{
    http::{internal_server_error, Request, Response},
    http_component, redis,
};

const HELP: &str = r"mitchellhynes.com - API
---
GET /        # You are here

POST /like_page  # {'url': ...}  -  Likes a URL
POST /get_likes  # {'url': ...}  -  Get likes for a page
                 # Visit https://mitchellhynes.com/sitemap.xml to see all pages.";

const HEADER_SPIN_ROUTE: &str = "spin-raw-component-route";

const REDIS_ADDRESS_ENV: &str = "REDIS_ADDRESS";
const REDIS_CHANNEL_ENV: &str = "REDIS_CHANNEL";

#[derive(Serialize, Deserialize)]
struct Payload<'a> {
    url: &'a str,
}

#[derive(Serialize, Deserialize)]
struct LikedPagesResponse {
    number: usize,
}

#[derive(Serialize, Deserialize)]
struct Output<'a> {
    message: &'a str,
}

fn value_contains_uuid(value: &[u8], uuid: &[u8]) -> bool {
    value.chunks(13).any(|chunk| {
        uuid.iter()
            .zip(chunk.iter())
            .any(|(value1, value2)| value1 == value2)
    })
}

fn get_links<T: AsRef<[u8]>>(source: T) -> Vec<String> {
    let mut out = vec![];
    let mut iter = source.as_ref().windows(5);
    // got a better way to do this? please contribute

    // can't use a for here
    while let Some(slice) = iter.next() {
        if "<loc>".as_bytes() == slice {
            // can't use skip here
            iter.next();
            iter.next();
            iter.next();
            iter.next();
            let mut string = vec![];
            for slice in iter.by_ref() {
                if "</loc".as_bytes() == slice {
                    break;
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

fn message(message: &str) -> Result<Option<bytes::Bytes>> {
    Ok(Some(serde_json::to_vec(&Output { message })?.into()))
}

fn handle_post(req: Request) -> Result<Response> {
    let address = std::env::var(REDIS_ADDRESS_ENV).expect("Couldn't find REDIS addr");
    let channel = std::env::var(REDIS_CHANNEL_ENV).expect("Couldn't find REDIS channel");
    let headers = req.headers();
    let body = req.body();
    let path = headers
        .get(HEADER_SPIN_ROUTE)
        .ok_or_else(|| anyhow::anyhow!("Missing component route."))?
        .to_str()
        .map_err(|_| anyhow::anyhow!("Error parsing path."))?;

    let heelo = http::Response::builder()
        .status(200)
        .header("Set-Cookie", format!("token={}; HttpOnly", &get_token()))
        .body(message("Cookie set.")?)
        .map_err(|e| e.into());

    if let Some((iat, value)) = with_authentication(req)? {}

    if let Some(body_str) = body {
        let body_parsed = std::str::from_utf8(body_str)?;
        if path == "/authenticate" {
            return http::Response::builder()
                .status(201)
                .body(None)
                .map_err(|e| e.into());
        }

        let sites = get_sitemap();
        let payload: Payload = match serde_json::from_str(body_parsed) {
            Ok(body) => body,
            Err(_) => {
                return http::Response::builder()
                    .status(400)
                    .body(message("Missing body.")?)
                    .map_err(|e| e.into())
            }
        };

        if !sites.iter().any(|i| i == payload.url) {
            return http::Response::builder()
                .status(404)
                .body(message("Site not found. Please specify a valid `url`")?)
                .map_err(|e| e.into());
        }

        if path == "/get_likes" {
            let payload =
                redis::get(&address, payload.url).map_err(|_| anyhow!("Error querying Redis"))?;

            return match redis::publish(&address, &channel, &payload) {
                Ok(()) => Ok(http::Response::builder().status(200).body(Some(
                    serde_json::to_vec(&LikedPagesResponse {
                        number: payload.iter().filter(|item| **item == b',').count(),
                    })?
                    .into(),
                ))?),
                Err(_e) => internal_server_error(),
            };
        }

        if path == "/like_page" {
            let mut previous = redis::get(&address, payload.url).unwrap_or_default();
            if value_contains_uuid(&previous, iat) {
                return http::Response::builder()
                    .status(400)
                    .body(message("Already liked.")?)
                    .map_err(|e| e.into());
            }

            let mut new_value = iat.to_vec();
            new_value.push(b','); // uuid,uuid,uuid,
            previous.extend(new_value);

            redis::set(&address, payload.url, &previous)
                .map_err(|_| anyhow!("Error executing Redis command"))?;

            let payload =
                redis::get(&address, value).map_err(|_| anyhow!("Error querying Redis"))?;

            return match redis::publish(&address, &channel, &payload) {
                Ok(()) => Ok(http::Response::builder()
                    .status(200)
                    .body(message("Liked message")?)?),
                Err(_e) => internal_server_error(),
            };
        }

        http::Response::builder()
            .status(400)
            .body(message("Missing payload.")?)
            .map_err(|e| e.into())
    } else {
        http::Response::builder()
            .status(400)
            .body(message("Missing payload.")?)
            .map_err(|e| e.into())
    }
}

fn handle_get() -> Result<Response> {
    http::Response::builder()
        .status(400)
        .body(Some(HELP.into()))
        .map_err(|e| e.into())
}

#[http_component]
fn hello_world(req: Request) -> Result<Response> {
    if req.method() == "GET" {
        handle_get()
    } else if req.method() == "POST" {
        handle_post(req)
    } else {
        http::Response::builder()
            .status(400)
            .body(message("Only GET and POST are allowed.")?)
            .map_err(|e| e.into())
    }
}
