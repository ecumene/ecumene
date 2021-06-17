use comrak::{markdown_to_html, ComrakOptions};
use toml;

use crate::structs::Markdown;

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
    let mut options = ComrakOptions::default();
    options.extension.tasklist = true;
    options.extension.front_matter_delimiter = Some(FRONTMATTER_DELIMITER.to_owned());

    let html = markdown_to_html(&source, &options);
    let meta = parse_frontmatter(&source).expect("No frontmatter for source");

    Ok(Markdown {
        meta: meta?,
        content_html: html,
        content_markdown: String::from(source),
    })
}
