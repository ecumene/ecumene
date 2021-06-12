use crate::date::fogo_date::fmt_date;
use crate::error::Result;
use crate::structs::{Post, PostFrontMatter, Site};
use crate::templating::TEMPLATES;
use serde::{Deserialize, Serialize};

use std::path::PathBuf;
use tera::Context;

#[derive(Serialize, Deserialize, Debug)]
pub enum Asset {
    HTML(BuildArtifact),
    XML(BuildArtifact),
    Other(CopyFile),
}

#[derive(Serialize, Deserialize, Debug)]
pub struct BuildArtifact {
    pub path: PathBuf,
    pub content: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CopyFile {
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
    format!("public/blog/{}.html", slug)
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

pub fn index_blog(site: &Site) -> Result<Asset> {
    let mut context = Context::new();
    context.insert("posts", &site.posts);
    Ok(Asset::HTML(BuildArtifact {
        path: PathBuf::from("public/blog/index.html"),
        content: TEMPLATES.render("blogindex.html", &context)?,
    }))
}

pub fn sitemap(site: &Site) -> Result<Asset> {
    let mut context = Context::new();
    context.insert("posts", &site.posts);
    Ok(Asset::XML(BuildArtifact {
        path: PathBuf::from("public/sitemap.xml"),
        content: TEMPLATES.render("sitemap.xml", &context)?,
    }))
}

impl Build for Site {
    fn build(self, site: &mut BuiltSite) -> Result<()> {
        site.assets.push(index_blog(&self)?);
        site.assets.push(sitemap(&self)?);
        site.assets.extend(self.assets);
        self.posts
            .into_iter()
            .map(|post| post.build(site))
            .collect()
    }
}
