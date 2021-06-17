use crate::parser::parse;
use crate::structs::{Author, Post};

use crate::builder::{Asset, CopyFile};
use std::fs;
use std::fs::DirEntry;
use std::io;

fn load_and_parse_post(dir_entry: std::io::Result<DirEntry>) -> crate::error::Result<Post> {
    let entry = dir_entry?;
    if entry.file_type()?.is_dir() {
        return Err(io::Error::from(io::ErrorKind::InvalidInput).into());
    }
    parse(&fs::read_to_string(&entry.path())?).map_err(|err| crate::error::Error::Toml(err))
}

fn load_and_parse_author(dir_entry: std::io::Result<DirEntry>) -> crate::error::Result<Author> {
    let entry = dir_entry?;
    if entry.file_type()?.is_dir() {
        return Err(io::Error::from(io::ErrorKind::InvalidInput).into());
    }
    parse(&fs::read_to_string(&entry.path())?).map_err(|err| crate::error::Error::Toml(err))
}

fn collect_others(dir_entry: std::io::Result<DirEntry>) -> crate::error::Result<Asset> {
    let entry = dir_entry?;
    if entry.file_type()?.is_dir() {
        return Err(io::Error::from(io::ErrorKind::InvalidInput).into());
    }
    let path = entry.path();
    Ok(Asset::Other(CopyFile { path }))
}

pub fn fetch_posts() -> crate::error::Result<Vec<Post>> {
    fs::read_dir("./posts")?.map(load_and_parse_post).collect()
}

pub fn fetch_authors() -> crate::error::Result<Vec<Author>> {
    fs::read_dir("./authors")?
        .map(load_and_parse_author)
        .collect()
}

pub fn fetch_assets() -> crate::error::Result<Vec<Asset>> {
    fs::read_dir("./assets")?.map(collect_others).collect()
}
