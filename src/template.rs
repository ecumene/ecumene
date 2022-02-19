use crate::date::mitch_date;
use chrono::DateTime;
use chrono::Utc;
use comrak::{markdown_to_html, ComrakOptions};
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use tera::Tera;
use toml;

lazy_static! {
    pub static ref COMRAK_OPTIONS: ComrakOptions = {
        let mut options = ComrakOptions::default();
        options.extension.tasklist = true;
        options.extension.front_matter_delimiter = Some(FRONTMATTER_DELIMITER.to_owned());
        options
    };
}

#[derive(Deserialize, Serialize)]
pub struct Markdown<T> {
    pub meta: T,
    pub content_markdown: String,
    pub content_html: String,
}

const FRONTMATTER_DELIMITER: &'static str = "---";

pub fn parse_frontmatter<'de, T>(post: &'de str) -> Option<Result<T, toml::de::Error>>
where
    T: serde::Deserialize<'de>,
{
    let first_line = post.lines().next();
    let mut sections = post.split(FRONTMATTER_DELIMITER);
    if let Some(line) = first_line {
        if FRONTMATTER_DELIMITER == line {
            if let Some(toml) = sections.nth(1) {
                return Some(toml::from_str(toml));
            }
        }
    }
    None
}

pub fn parse<'de, T>(source: &'de str) -> Result<Markdown<T>, toml::de::Error>
where
    T: serde::Deserialize<'de>,
{
    let html = markdown_to_html(&source, &COMRAK_OPTIONS);
    let meta = parse_frontmatter(&source).expect("No frontmatter for source");

    Ok(Markdown {
        meta: meta?,
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

pub struct Mitch<'a> {
    name: &'a str,
    email: &'a str,
    twitter: &'a str,
    location: &'a str,
}

lazy_static! {
    pub static ref PROFILE: Mitch<'static> = {
        Mitch {
            name: "Mitch",
            email: "me@mitchellhynes.com",
            twitter: "hates_bitcoin",
            location: "newfoundland",
        }
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
