use anyhow::Result;

use crate::date::mitch_date::fmt_date;
use crate::template::{Post, TEMPLATES};
use crate::Site;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tera::Context;

#[derive(Serialize, Deserialize, Debug)]
pub enum Asset {
    Html(BuildArtifact),
    Xml(BuildArtifact),
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

pub trait FillTemplate {
    fn fill(self) -> Result<String>;
}

pub trait Build {
    fn build(self, site: &mut BuiltSite) -> Result<()>;
}

impl FillTemplate for Post {
    fn fill(self) -> Result<String> {
        let Post {
            meta,
            content_html,
            content_markdown: _,
        } = self;
        let mut context = Context::new();
        context.insert("title", &meta.title);
        context.insert("html", &content_html);
        context.insert("created_date", &fmt_date(&meta.created_date));
        context.insert("last_modified_date", &fmt_date(&meta.last_modified_date));
        Ok(TEMPLATES.render("blog/post.html", &context)?)
    }
}

impl Build for Post {
    fn build(self, site: &mut BuiltSite) -> Result<()> {
        site.assets.push(Asset::Html(BuildArtifact {
            path: PathBuf::from(format!("public/blog/{}", &self.meta.slug)),
            content: self.fill()?,
        }));
        Ok(())
    }
}

pub fn index(site: &Site, folder: &str) -> Result<Asset> {
    let mut context = Context::new();
    context.insert("posts", &site.posts);
    context.insert("readme", &site.readme);
    Ok(Asset::Html(BuildArtifact {
        path: PathBuf::from(format!("public/{}index.html", folder)),
        content: TEMPLATES.render(&format!("{}index.html", folder), &context)?,
    }))
}

pub fn sitemap(site: &Site) -> Result<Asset> {
    let mut context = Context::new();
    context.insert("posts", &site.posts);
    Ok(Asset::Xml(BuildArtifact {
        path: PathBuf::from("public/sitemap.xml"),
        content: TEMPLATES.render("sitemap.xml", &context)?,
    }))
}

pub fn feed(site: &Site) -> Result<Asset> {
    let mut context = Context::new();
    context.insert("posts", &site.posts);
    Ok(Asset::Xml(BuildArtifact {
        path: PathBuf::from("public/feed.xml"),
        content: TEMPLATES.render("rss.xml", &context)?,
    }))
}

impl<'a> Build for Site {
    fn build(self, site: &mut BuiltSite) -> Result<()> {
        site.assets.push(index(&self, "")?);
        site.assets.push(index(&self, "blog/")?);
        site.assets.push(feed(&self)?);
        site.assets.push(sitemap(&self)?);
        site.assets.extend(self.assets);
        self.posts
            .into_iter()
            .try_for_each(|post| post.build(site))?;
        Ok(())
    }
}
