use crate::error::Result;
use crate::structs::Author;
use reqwest::blocking::Response;

fn fetch_author(username: &str) -> Result<Response> {
  let client = reqwest::blocking::Client::builder()
    .user_agent("Site/1.0.0 (https://github.com/fogo-sh/fogo.sh)")
    .build()?;
  let response = client
    .get(format!("https://api.github.com/users/{}", username))
    .send()?;

  Ok(response)
}

pub fn fetch() -> Result<Vec<Author>> {
  let author_response = fetch_author("jackharrhy")?.text()?;
  let author = serde_json::from_str(&author_response)?;

  Ok(vec![author])
}
