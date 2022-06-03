use anyhow::{anyhow, Result};
use cookie::Cookie;
use hmac::{Hmac, Mac};
use jwt::{SignWithKey, VerifyWithKey};
use sha2::Sha256;
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use spin_sdk::{http::Request, redis};

const REDIS_ADDRESS_ENV: &str = "SPIN_APP_REDIS_ADDRESS";
const JWT_SECRET: &str = "JWT_SECRET";

#[derive(Serialize, Deserialize)]
struct Payload<'a> {
    url: &'a str,
}

#[derive(Serialize, Deserialize)]
struct LikedPagesResponse {
    number: usize,
}

fn get_links<T: AsRef<[u8]>>(source: T) -> Vec<String> {
    let mut out = vec![];
    let mut iter = source.as_ref().windows(5);
    // got a better way to do this? please contribute

    // can't use a for here
    while let Some(slice) = iter.next() {
        if "<loc>".as_bytes() == slice {
            // can't use skip here
            iter.next();
            iter.next();
            iter.next();
            iter.next();
            let mut string = vec![];
            for slice in iter.by_ref() {
                if "</loc".as_bytes() == slice {
                    break;
                }
                string.push(slice[0]);
            }
            out.push(
                std::str::from_utf8(&string)
                    .expect("That's not UTF8, Piotr.")
                    .to_owned(),
            );
        }
    }

    out
}

fn get_sitemap() -> Vec<String> {
    get_links(
        spin_sdk::outbound_http::send_request(
            http::Request::builder()
                .method("GET")
                .uri("https://mitchellhynes.com/sitemap.xml")
                .body(None)
                .expect("Sitemap: Request build error."),
        )
        .expect("Sitemap: Network error.")
        .body()
        .as_ref()
        .expect("Sitemap: Empty body."),
    )
}

pub fn get_token() -> String {
    let secret = std::env::var(JWT_SECRET).expect("Couldn't find JWT env.");
    let key: Hmac<Sha256> = Hmac::new_from_slice(secret.as_bytes()).unwrap();
    let mut claims = BTreeMap::new();
    let start = SystemTime::now();
    let since_the_epoch = start
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards");
    claims.insert("iat", since_the_epoch.as_secs().to_string());
    claims.sign_with_key(&key).expect("Failed to create token")
}

fn is_valid(token: &str) -> bool {
    let secret = std::env::var(JWT_SECRET).expect("Couldn't find JWT env.");
    let key: Hmac<Sha256> = Hmac::new_from_slice(secret.as_bytes()).unwrap();
    let claim_try: Result<BTreeMap<String, String>, jwt::Error> = token.verify_with_key(&key);
    match claim_try {
        Ok(claim) => claim.get("iat").is_some(),
        Err(_) => false,
    }
}

pub enum AuthResult {
    Ok { user_id: String, payload: String },
    SiteNotFound,
    Unauthorized,
    NoCookie,
}

pub fn is_authenticated(req: &Request) -> Result<AuthResult> {
    let address = std::env::var(REDIS_ADDRESS_ENV).expect("Couldn't find REDIS addr");
    let headers = req.headers();
    if let Some(cookie_str) = headers.get("cookie") {
        let cookie = cookie_str.to_str()?;
        let cookie = Cookie::parse(cookie)?;
        let (key, user_id) = cookie.name_value();
        let referer = headers
            .get("referer")
            .expect("Expected referer header.")
            .to_str()?;
        let referer = if referer.contains("http://localhost:3000/") {
            str::replace(
                referer,
                "http://localhost:3000/",
                "https://mitchellhynes.com/",
            )
        } else {
            referer.to_string()
        };
        if key == "token" {
            if !is_valid(user_id) {
                return Ok(AuthResult::Unauthorized);
            }

            let sites = get_sitemap();
            let payload = referer;

            if !sites.iter().any(|i| i == &payload) {
                return Ok(AuthResult::SiteNotFound);
            }
            println!("{}", user_id);

            Ok(AuthResult::Ok {
                user_id: user_id.to_owned(),
                payload: payload.to_owned(),
            })
        } else {
            Ok(AuthResult::Unauthorized)
        }
    } else {
        redis::set(&address, &get_token(), &[0])
            .map_err(|_| anyhow!("Error executing Redis command"))?;

        Ok(AuthResult::NoCookie)
    }
}
