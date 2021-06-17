use crate::error::Result;
use crate::structs::Author;
use reqwest::blocking::Response;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
struct OrgMember<'a> {
  login: &'a str,
}

fn fetch_user(username: &str) -> Result<Response> {
  let client = reqwest::blocking::Client::builder()
    .user_agent("Site/1.0.0 (https://github.com/fogo-sh/fogo.sh)")
    .build()?;
  let response = client
    .get(format!("https://api.github.com/users/{}", username))
    .send()?;

  Ok(response)
}

pub fn fetch() -> Result<Vec<Author>> {
  Ok(vec![])
}
