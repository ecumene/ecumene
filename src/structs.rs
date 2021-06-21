use chrono::{DateTime, Utc};

use serde::{Deserialize, Serialize};

use crate::builder::Asset;
use crate::date::{fogo_date, proper_date};
use crate::inventory;

#[derive(Deserialize, Serialize)]
pub struct GithubAuthor {
    pub avatar_url: String,
    pub followers: u8,
    pub login: String,
    pub name: String,
    #[serde(with = "proper_date")]
    pub created_at: DateTime<Utc>,
}

#[derive(Deserialize, Serialize)]
pub struct AuthorFrontMatter {
    pub tagline: String,
    pub username: String,
    pub github: Option<GithubAuthor>,
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
pub struct Markdown<T> {
    pub meta: T,
    pub content_markdown: String,
    pub content_html: String,
}

pub type Post = Markdown<PostFrontMatter>;
pub type Author = Markdown<AuthorFrontMatter>;

#[derive(Default, Deserialize, Serialize)]
pub struct Site {
    pub authors: Vec<Author>,
    pub posts: Vec<Post>,
    pub assets: Vec<Asset>,
}

impl Site {
    pub fn load_all() -> crate::error::Result<Site> {
        Ok(Site {
            authors: inventory::fetch_authors()?,
            posts: inventory::fetch_posts()?,
            assets: inventory::fetch_assets()?,
        })
    }
}
