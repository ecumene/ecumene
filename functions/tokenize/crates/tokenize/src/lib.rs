use anyhow::Context;
use anyhow::{anyhow, Result};
use cookie::Cookie;
use hmac::{Hmac, Mac};
use jwt::{SignWithKey, VerifyWithKey};
use sha2::Sha256;
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use spin_sdk::http::Request;

const JWT_SECRET: &str = "JWT_SECRET";

pub fn get_token() -> String {
    let secret = std::env::var(JWT_SECRET).expect("Couldn't find JWT env.");
    let key: Hmac<Sha256> = Hmac::new_from_slice(secret.as_bytes()).unwrap();
    let mut claims = BTreeMap::new();
    let start = SystemTime::now();
    let since_the_epoch = start
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards");
    claims.insert("iat", since_the_epoch.as_millis().to_string());
    claims.sign_with_key(&key).expect("Failed to create token")
}

fn is_valid(token: &str) -> Option<String> {
    let secret = std::env::var(JWT_SECRET).expect("Couldn't find JWT env.");
    let key: Hmac<Sha256> = Hmac::new_from_slice(secret.as_bytes()).unwrap();
    let claim_try: Result<BTreeMap<String, String>, jwt::Error> = token.verify_with_key(&key);
    match claim_try {
        Ok(claim) => claim.get("iat").cloned(),
        Err(_) => None,
    }
}

type IAT<'a> = &'a [u8];
type IATStr<'a> = &'a str;
pub fn with_authentication<'a>(req: Headers) -> Result<Option<(IAT<'a>, IATStr<'a>)>> {
    let cookie_str = req.headers().get("cookie").context("No cookie found.")?;

    let cookie = cookie_str.to_str()?;
    let cookie = Cookie::parse(cookie)?;
    let (key, value) = cookie.name_value();

    if key == "token" {
        let iat = is_valid(value).context("Invalid token. (How did you get here?)")?;
        let iat = iat.as_bytes();
        Ok(Some((iat, value)))
    } else {
        Ok(None)
    }
}
