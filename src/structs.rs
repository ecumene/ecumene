use chrono::{DateTime, Utc};

use serde::{Deserialize, Serialize};

use crate::date::fogo_date;
use crate::{authors, posts};

#[derive(Default, Deserialize, Serialize)]
pub struct Author<'a> {
    pub github_username: &'a str,
    pub name: &'a str,
    pub website: &'a str,
    pub image_url: &'a str,
    pub about_markdown: &'a str,
}

pub type Authors = Vec<String>;

#[derive(Deserialize, Serialize)]
pub struct PostFrontMatter {
    pub slug: String,
    pub title: String,
    pub authors: Authors,
    #[serde(with = "fogo_date")]
    pub created_date: DateTime<Utc>,
    #[serde(with = "fogo_date")]
    pub last_modified_date: DateTime<Utc>,
}

#[derive(Deserialize, Serialize)]
pub struct Post {
    pub meta: PostFrontMatter,
    pub content_markdown: String,
    pub content_html: String,
}

#[derive(Default, Deserialize, Serialize)]
pub struct Site<'a> {
    #[serde(borrow)]
    pub authors: Vec<Author<'a>>,
    pub posts: Vec<Post>,
}

impl<'a> Site<'a> {
    pub fn load_all() -> crate::error::Result<Site<'a>> {
        Ok(Site {
            authors: authors::fetch()?,
            posts: posts::fetch()?,
        })
    }
}
