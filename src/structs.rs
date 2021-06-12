use chrono::{DateTime, Utc};

use serde::{Deserialize, Serialize};

use crate::builder::Asset;
use crate::date::fogo_date;
use crate::{authors, inventory};

#[derive(Default, Deserialize, Serialize)]
pub struct Author {
    pub login: String,
    pub name: String,
    pub blog: String,
    pub avatar_url: String,
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
pub struct Site {
    pub authors: Vec<Author>,
    pub posts: Vec<Post>,
    pub assets: Vec<Asset>,
}

impl Site {
    pub fn load_all() -> crate::error::Result<Site> {
        Ok(Site {
            authors: authors::fetch()?,
            posts: inventory::fetch_posts()?,
            assets: inventory::fetch_assets()?,
        })
    }
}
