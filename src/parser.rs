use comrak::{markdown_to_html, ComrakOptions};
use toml;

use crate::structs::{Post, PostFrontMatter};

const FRONTMATTER_DELIMITER: &'static str = "---";

pub fn parse_frontmatter(post: &str) -> Option<Result<PostFrontMatter, toml::de::Error>> {
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

pub fn parse(source: String) -> Result<Post, toml::de::Error> {
    let mut options = ComrakOptions::default();
    options.extension.tasklist = true;
    options.extension.front_matter_delimiter = Some(FRONTMATTER_DELIMITER.to_owned());

    let html = markdown_to_html(&source, &options);
    let meta = parse_frontmatter(&source).expect("No frontmatter for source");

    Ok(Post {
        meta: meta?,
        content_html: html,
        content_markdown: source,
    })
}
