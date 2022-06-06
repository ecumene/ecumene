use anyhow::{anyhow, Result};
use spin_sdk::{
    http::{Request, Response},
    http_component,
};

fn make_splain(input: &str) -> String {
    format!(
        "
    <head>
        <meta charset=\"utf-8\" />
        <link rel=\"stylesheet\" href=\"/index.css\" />
        <link rel=\"shortcut icon\" type=\"image/ico\" href=\"/favicon.ico\" />
        <meta content=\"width=device-width, initial-scale=1\" name=\"viewport\" />
    </head>
    <fieldset>
        <legend>mitchsplain</legend>
        {}
    </fieldset>
    ",
        input
    )
}

#[http_component]
fn serve(req: Request) -> Result<Response> {
    let uri = req.uri();
    let options = uri.query().ok_or_else(|| anyhow!("Missing message param."));
    let message = options?
        .split('=')
        .nth(1)
        .ok_or_else(|| anyhow!("Missing message."))?
        .replace("%20", " ");

    if req.method() != "GET" {
        return Err(anyhow!(
            "Only GET allowed. (try: GET /splain?message=asdfasdfadsf)"
        ));
    };

    http::Response::builder()
        .status(200)
        .header("Content-Type", "text/html; charset=UTF-8")
        .body(Some(make_splain(&message).into()))
        .map_err(|err| err.into())
}
