mod builder;
mod date;
mod template;
mod writer;

use anyhow::Result;
use comrak::markdown_to_html;
use std::fs;
use walkdir::WalkDir;

use std::fs::DirEntry;
use std::io;
use std::path::Path;

use crate::builder::*;
use crate::builder::{Asset, CopyFile};
use crate::template::{parse, Post, COMRAK_OPTIONS};
use crate::writer::*;

fn load_readme<P: AsRef<Path>>(path: P) -> Result<String> {
    Ok(markdown_to_html(
        &fs::read_to_string(path)?,
        &COMRAK_OPTIONS,
    ))
}

fn load_and_parse_post(dir_entry: std::io::Result<DirEntry>) -> Result<Post> {
    let entry = dir_entry?;
    if entry.file_type()?.is_dir() {
        return Err(io::Error::from(io::ErrorKind::InvalidInput).into());
    }
    parse(&fs::read_to_string(&entry.path())?).map_err(|e| e.into())
}

fn collect_others(dir_entry: walkdir::DirEntry) -> Result<Asset> {
    let entry = dir_entry;
    if entry.file_type().is_dir() {
        return Err(io::Error::from(io::ErrorKind::InvalidInput).into());
    }
    let path = entry.path().to_owned();
    Ok(Asset::Other(CopyFile { path }))
}

pub fn fetch_posts() -> Result<Vec<Post>> {
    fs::read_dir("./posts")?.map(load_and_parse_post).collect()
}

pub fn fetch_assets() -> Result<Vec<Asset>> {
    WalkDir::new("assets")
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| !e.file_type().is_dir())
        .map(collect_others)
        .collect()
}

pub struct Site {
    readme: String,
    posts: Vec<Post>,
    assets: Vec<Asset>,
}

impl Site {
    pub fn load_all() -> Result<Site> {
        Ok(Site {
            readme: load_readme(Path::new("./README.md"))?,
            posts: fetch_posts()?,
            assets: fetch_assets()?,
        })
    }
}

fn main() -> Result<()> {
    let site = Site::load_all()?;

    let mut built_site = BuiltSite::default();

    site.build(&mut built_site)?;

    built_site.write()?;

    Ok(())
}
