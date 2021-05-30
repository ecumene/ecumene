use crate::structs::Author;

fn fetch_author(username: &str) -> reqwest::Result<Author> {
  let client = reqwest::blocking::Client::builder()
    .user_agent("Site/1.0.0 (https://github.com/fogo-sh/fogo.sh)")
    .build()?;
  let response = client
    .get(format!("https://api.github.com/users/{}", username))
    .send()?;

  let text = response.text()?;

  println!("{}", text);

  Ok(Author::default())
}

pub fn fetch<'a>() -> reqwest::Result<Vec<Author<'a>>> {
  let author = fetch_author("jackharrhy")?;

  Ok(vec![author])
}
