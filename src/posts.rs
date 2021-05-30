use crate::parser::parse;
use crate::structs::Post;
use std::fs;
use std::fs::DirEntry;

fn load_and_parse(dir_entry: std::io::Result<DirEntry>) -> crate::error::Result<Post> {
    let source = fs::read_to_string(&(&dir_entry?).path());
    parse(source?).map_err(|err| crate::error::Error::Toml(err))
}

pub fn fetch() -> crate::error::Result<Vec<Post>> {
    let paths = fs::read_dir("./posts")?;

    paths.map(load_and_parse).collect()
}
