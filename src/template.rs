use crate::date::mitch_date;
use chrono::{DateTime, Utc};
use lazy_static::lazy_static;
use pulldown_cmark::Event;
use serde::{Deserialize, Serialize};
use tera::Tera;

pub fn custom_markdown_to_html<T>(input: T) -> String
where
    T: AsRef<str>,
{
    use pulldown_cmark::{html, Options, Parser};

    // Set up options and parser. Strikethroughs are not part of the CommonMark standard
    // and we therefore must enable it explicitly.
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_FOOTNOTES);
    let parser = Parser::new_ext(input.as_ref(), options).map(|event| match event {
        Event::Html(text) => Event::Html(
            text.replace("<mitchsplain>", "<fieldset><legend>mitchsplain</legend>")
                .replace("</mitchsplain>", "</fieldset>")
                .into(),
        ),
        _ => event,
    });

    // Write to String buffer.
    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);

    // Check that the output is what we expected.
    html_output
}

#[derive(Deserialize, Serialize)]
pub struct Markdown<T> {
    pub meta: T,
    pub content_markdown: String,
    pub content_html: String,
}

const FRONTMATTER_DELIMITER: &str = "---";

pub fn parse_frontmatter<'de, T>(post: &'de str) -> Result<(T, &'de str), toml::de::Error>
where
    T: serde::Deserialize<'de>,
{
    if !post.starts_with(FRONTMATTER_DELIMITER) {
        panic!("Couldn't find start delimiter.");
    }

    let slice = &post[FRONTMATTER_DELIMITER.len()..];
    let index_of_ending_line = slice
        .find(FRONTMATTER_DELIMITER)
        .expect("Couldn't find end delimiter.");
    Ok((
        toml::from_str(&slice[..index_of_ending_line])?,
        &slice[(index_of_ending_line + FRONTMATTER_DELIMITER.len())..],
    ))
}

pub fn parse<'de, T>(source: &'de str) -> Result<Markdown<T>, toml::de::Error>
where
    T: serde::Deserialize<'de>,
{
    let (meta, rest): (T, &'de str) = parse_frontmatter(source)?;
    let html = custom_markdown_to_html(rest);

    Ok(Markdown {
        meta,
        content_html: html,
        content_markdown: String::from(source),
    })
}

lazy_static! {
    pub static ref TEMPLATES: Tera = {
        let tera = match Tera::new("templates/**/*") {
            Ok(t) => t,
            Err(e) => {
                println!("Parsing error(s): {}", e);
                ::std::process::exit(1);
            }
        };
        tera
    };
}

#[derive(Deserialize, Serialize)]
pub struct PostFrontMatter {
    pub slug: String,
    pub title: String,
    pub description: String,
    #[serde(with = "mitch_date")]
    pub created_date: DateTime<Utc>,
    #[serde(with = "mitch_date")]
    pub last_modified_date: DateTime<Utc>,
}

pub type Post = Markdown<PostFrontMatter>;
