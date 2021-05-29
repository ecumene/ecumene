use comrak::{markdown_to_html, ComrakOptions};
use std::fs;
use std::path::Path;
use toml;

use crate::structs::{Post, PostFrontMatter};

pub fn parse_frontmatter(post: String) -> Option<PostFrontMatter> {
    let first_line = post.lines().next();
    let mut sections = post.split("---");
    if let Some(line) = first_line {
        if "---" == line {
            if let Some(toml) = sections.nth(1) {
                return Some(toml::from_str(toml).unwrap());
            }
        }
    }
    None
}

pub fn parse(path: &Path) -> Post {
    let mut options = ComrakOptions::default();
    options.extension.tasklist = true;
    options.extension.front_matter_delimiter = Some("---".to_owned());

    let source = fs::read_to_string(path).unwrap();
    let html = markdown_to_html(&source, &options);
    let meta = parse_frontmatter(source).expect(&format!("No frontmatter for {}", path.display()));

    Post::new(meta, html)
}
