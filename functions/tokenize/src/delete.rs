use crate::key_value::filter_for_uuid;
use crate::Output;

use anyhow::{anyhow, Result};

use serde::{Deserialize, Serialize};
use spin_sdk::{http::Response, redis};

#[derive(Serialize, Deserialize)]
struct Payload<'a> {
    url: &'a str,
}

fn message(message: &str) -> Result<Option<bytes::Bytes>> {
    Ok(Some(serde_json::to_vec(&Output { message })?.into()))
}

pub fn handler(user_id: &str, payload: &str) -> Result<Response> {
    let address =
        std::env::var(crate::key_value::REDIS_ADDRESS_ENV).expect("Couldn't find REDIS addr");

    let previous = redis::get(&address, payload).unwrap_or_default();
    let filtered = filter_for_uuid(&previous, user_id.as_bytes());

    redis::set(&address, payload, &filtered)
        .map_err(|_| anyhow!("Error executing Redis command"))?;

    http::Response::builder()
        .status(200)
        .body(message("Liked message")?)
        .map_err(|e| e.into())
}
