use crate::date::fogo_date::fmt_date;
use crate::error::Result;
use crate::structs::{Post, PostFrontMatter, Site};
use crate::templating::TEMPLATES;

use std::path::PathBuf;
use tera::Context;

#[derive(Debug)]
pub enum Asset {
    CSS(MoveFile),
    HTML(BuildArtifact),
    JS(MoveFile),
}

#[derive(Debug)]
pub struct BuildArtifact {
    pub path: PathBuf,
    pub content: String,
}

#[derive(Debug)]
pub struct MoveFile {
    pub path: PathBuf,
}

#[derive(Default, Debug)]
pub struct BuiltSite {
    pub assets: Vec<Asset>,
}

pub trait Build {
    fn build(self, site: &mut BuiltSite) -> Result<()>;
}

fn format_slug(slug: &str) -> String {
    format!("public/{}.html", slug)
}

fn format_html(meta: &PostFrontMatter, html: String) -> Result<String> {
    let mut context = Context::new();
    context.insert("title", &meta.title);
    context.insert("html", &html);
    context.insert("authors", &meta.authors);
    context.insert("created_date", &fmt_date(&meta.created_date));
    context.insert("last_modified_date", &fmt_date(&meta.last_modified_date));
    Ok(TEMPLATES.render("blogpost.html", &context)?)
}

impl Build for Post {
    fn build(self, site: &mut BuiltSite) -> Result<()> {
        site.assets.push(Asset::HTML(BuildArtifact {
            path: PathBuf::from(format_slug(&self.meta.slug)),
            content: format_html(&self.meta, self.content_html)?,
        }));
        Ok(())
    }
}

pub fn index_blog<'a>(site: &Site<'a>) -> Result<Asset> {
    let mut context = Context::new();
    context.insert("posts", &site.posts);
    Ok(Asset::HTML(BuildArtifact {
        path: PathBuf::from("public/blog/index.html"),
        content: TEMPLATES.render("blogindex.html", &context)?,
    }))
}

impl<'a> Build for Site<'a> {
    fn build(self, site: &mut BuiltSite) -> Result<()> {
        site.assets.push(index_blog(&self)?);
        self.posts
            .into_iter()
            .map(|post| post.build(site))
            .collect()
    }
}
