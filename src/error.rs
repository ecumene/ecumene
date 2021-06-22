#[derive(Debug)]
pub enum Error {
    Reqwest(reqwest::Error),
    Tera(tera::Error),
    Io(std::io::Error),
    Json(serde_json::Error),
    Toml(toml::de::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

impl From<tera::Error> for Error {
    fn from(error: tera::Error) -> Error {
        Error::Tera(error)
    }
}

impl From<reqwest::Error> for Error {
    fn from(error: reqwest::Error) -> Error {
        Error::Reqwest(error)
    }
}

impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Error {
        Error::Json(error)
    }
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Error {
        Error::Io(error)
    }
}

impl From<toml::de::Error> for Error {
    fn from(error: toml::de::Error) -> Error {
        Error::Toml(error)
    }
}
