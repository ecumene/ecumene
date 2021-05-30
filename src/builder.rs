use crate::structs::{Post, Site};
use std::path::PathBuf;

pub enum Asset {
    CSS(MoveFile),
    HTML(BuildArtifact),
    JS(MoveFile),
}

pub struct BuildArtifact {
    pub path: PathBuf,
    pub content: String,
}

pub struct MoveFile {
    path: PathBuf,
}

impl From<Post> for Asset {
    fn from(post: Post) -> Asset {
        Asset::HTML(BuildArtifact {
            path: PathBuf::from(post.meta.slug),
            content: post.content_html,
        })
    }
}

pub fn builder(site: Site) -> Vec<Asset> {
    site.posts.into_iter().map(Asset::from).collect()
}
