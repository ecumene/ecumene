use anyhow::anyhow;
use anyhow::Result;
use cookie::Cookie;
use spin_sdk::{
    http::{internal_server_error, Request, Response},
    http_component, redis,
};

const REDIS_ADDRESS_ENV: &str = "REDIS_ADDRESS";
const REDIS_CHANNEL_ENV: &str = "REDIS_CHANNEL";

struct Payload {
    page_id: String,
}

#[http_component]
fn hello_world(req: Request) -> Result<Response> {
    let address = std::env::var(REDIS_ADDRESS_ENV)?;
    let channel = std::env::var(REDIS_CHANNEL_ENV)?;

    if req.method() == "GET" {
        let headers = req.headers();

        if let Some(cookie_str) = headers.get("cookie") {
            let cookie = Cookie::parse(cookie_str.to_str()?)?;
            let (key, value) = cookie.name_value();
            if key == "token" {
                let payload =
                    redis::get(&address, &"mykey").map_err(|_| anyhow!("Error querying Redis"))?;

                redis::set(&address, &"spin-example", &b"Eureka!"[..])
                    .map_err(|_| anyhow!("Error executing Redis command"))?;

                match redis::publish(&address, &channel, &payload) {
                    Ok(()) => Ok(http::Response::builder().status(200).body(None)?),
                    Err(_e) => internal_server_error(),
                }
            } else {
                http::Response::builder()
                    .status(400)
                    .body(None)
                    .map_err(|e| e.into())
            }
        } else {
            http::Response::builder()
                .status(401)
                .body(None)
                .map_err(|e| e.into())
        }
    } else {
        http::Response::builder()
            .status(400)
            .body(None)
            .map_err(|e| e.into())
    }
}
