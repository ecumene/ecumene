use crate::key_value::value_contains_uuid;
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

    let formatted_name = format!("likes:{}", payload);
    let localized_name = &formatted_name.as_str();

    let mut previous = redis::get(&address, localized_name).unwrap_or_default();
    if value_contains_uuid(&previous, user_id.as_bytes()) {
        return http::Response::builder()
            .status(400)
            .body(message("Already liked.")?)
            .map_err(|e| e.into());
    }

    let mut new_value = user_id.as_bytes().to_vec().clone();
    new_value.push(b','); // uuid,uuid,uuid,
    previous.extend(new_value);

    redis::set(&address, localized_name, &previous)
        .map_err(|_| anyhow!("Error executing Redis command"))?;

    http::Response::builder()
        .status(200)
        .body(message("Liked message")?)
        .map_err(|e| e.into())
}
