use crate::key_value::value_contains_uuid;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use spin_sdk::{http::Response, redis};

#[derive(Serialize, Deserialize)]
struct LikedPagesResponse {
    has_liked: bool,
    number: usize,
}

pub fn handler(user_id: &str, payload: &str) -> Result<Response> {
    let address =
        std::env::var(crate::key_value::REDIS_ADDRESS_ENV).expect("Couldn't find REDIS addr");

    let formatted_name = format!("likes:{}", payload);
    let localized_name = &formatted_name.as_str();
    let previous = redis::get(&address, localized_name).unwrap_or_default();
    let has_liked = value_contains_uuid(&previous, user_id.as_bytes());

    let payload =
        redis::get(&address, localized_name).map_err(|_| anyhow!("Error querying Redis"))?;

    http::Response::builder()
        .status(200)
        .body(Some(
            serde_json::to_vec(&LikedPagesResponse {
                has_liked,
                number: payload.iter().filter(|item| **item == b',').count(),
            })?
            .into(),
        ))
        .map_err(|e| e.into())
}
