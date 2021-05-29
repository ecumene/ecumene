use crate::structs::Author;

fn fetch_author(username: &str) -> Author {
  let response =
    reqwest::blocking::get(format!("https://api.github.com/users/{}", username)).unwrap();
  let text = response.text().unwrap();

  println!("{}", text);

  Author::default()
}

pub fn fetch<'a>() -> Vec<Author<'a>> {
  let author = fetch_author("jackharrhy");

  vec![author]
}
