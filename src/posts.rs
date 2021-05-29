use crate::parser::parse;
use crate::structs::Post;
use std::path::Path;

pub fn fetch() -> Vec<Post> {
    vec![parse(Path::new("./posts/test.md"))]
}
