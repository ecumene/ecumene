use anyhow::{Context, Result};
use ed25519_dalek::{PublicKey, Signature, Verifier};
use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};
use spin_sdk::{
    http::{Request, Response},
    http_component, redis,
};
use std::{collections::HashMap, fmt::Display, process::Command};

type Snowflake = str;

#[derive(Deserialize, Debug)]
struct InteractionDataOption<'a> {
    value: &'a str,
}

/// TODO: Polymorphize
#[derive(Deserialize, Debug)]
struct InteractionData<'a> {
    #[serde(borrow)]
    options: Vec<InteractionDataOption<'a>>,
}

#[derive(Deserialize, Debug)]
struct DiscordInteraction<'a> {
    id: &'a Snowflake,
    application_id: &'a Snowflake,
    #[serde(rename = "type")]
    command_type: u8,
    data: Option<InteractionData<'a>>,
    token: &'a str,
}

impl<'a> DiscordInteraction<'a> {
    // https://discord.com/developers/docs/interactions/receiving-and-responding#followup-messages
    pub fn reply<D: Display>(&self, message: D) -> Result<String> {
        Ok(std::str::from_utf8(
            spin_sdk::outbound_http::send_request(
                http::Request::builder()
                    .method("POST")
                    .header("Content-Type", "application/json")
                    // TODO: types
                    .uri(format!(
                        "https://discord.com/api/v10/interactions/{}/{}/callback",
                        self.id, self.token
                    ))
                    .body(Some(
                        format!("{{\"type\":4,\"data\":{{\"content\":\"{}\"}}}}", message).into(),
                    ))
                    .unwrap(),
            )?
            .body()
            .as_ref()
            .expect("Empty body"),
        )?
        .to_owned())
    }
}

#[repr(u8)]
#[derive(Deserialize_repr, Serialize_repr, Debug)]
enum CommandOptionType {
    SubCommand = 1,
    SubCommandGroup = 2,
    String = 3,
    Integer = 4,
    Boolean = 5,
    User = 6,
    Channel = 7,
    Role = 8,
    Mentionable = 9,
    Number = 10,
    Attachment = 11,
}

#[derive(Serialize, Deserialize, Debug)]
struct DiscordChoice<'a> {
    name: &'a str,
    value: &'a str,
}

// TODO: An enum would be nicer here. Don't want to impl SerDe...
const REQUIRED: bool = true;
// const NOT_REQUIRED: bool = true;

#[derive(Serialize, Deserialize, Debug)]
struct DiscordOption<'a> {
    name: &'a str,
    description: &'a str,
    #[serde(rename = "type")]
    command_type: CommandOptionType,
    required: bool,
    choices: Option<Vec<DiscordChoice<'a>>>,
}
// TODO: example for these
impl<'a> DiscordOption<'a> {
    fn new(
        name: &'a str,
        description: &'a str,
        command_type: CommandOptionType,
        required: bool,
    ) -> DiscordOption<'a> {
        DiscordOption {
            name,
            description,
            command_type,
            required,
            choices: None,
        }
    }

    fn add_choice(&mut self, choice: DiscordChoice<'a>) {
        if let Some(choices) = &mut self.choices {
            choices.push(choice);
        } else {
            self.choices = Some(vec![choice]);
        };
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct DiscordCommand<'a> {
    name: &'a str,
    description: &'a str,
    options: Option<Vec<DiscordOption<'a>>>,
}

impl<'a> DiscordCommand<'a> {
    fn new(name: &'a str, description: &'a str) -> DiscordCommand<'a> {
        DiscordCommand {
            name,
            description,
            options: None,
        }
    }

    fn add_option(&mut self, option: DiscordOption<'a>) {
        if let Some(options) = &mut self.options {
            options.push(option);
        } else {
            self.options = Some(vec![option]);
        };
    }
}

const DISCORD_PUB_KEY: &str = "DISCORD_PUB_KEY";
const DISCORD_BOT_TOKEN: &str = "DISCORD_BOT_TOKEN";
const REDIS_ADDRESS: &str = "SPIN_APP_REDIS_ADDRESS";

pub fn send_command(app_id: &str, command: DiscordCommand) -> Result<String> {
    let bot_token = std::env::var(DISCORD_BOT_TOKEN).expect("Couldn't find Discord Bot Token.");
    let json = serde_json::to_string(&command)?;
    let bytes = json.into();
    Ok(std::str::from_utf8(
        spin_sdk::outbound_http::send_request(
            http::Request::builder()
                .method("POST")
                .header("Authorization", format!("Bot {}", bot_token))
                .header("Content-Type", "application/json")
                .uri(format!(
                    "https://discord.com/api/v10/applications/{}/guilds/497544520695808000/commands",
                    app_id
                ))
                .body(Some(bytes))
                .unwrap(),
        )?
        .body()
        .as_ref()
        .expect("Empty body"),
    )?
    .to_owned())
}

// https://discord.com/developers/docs/interactions/receiving-and-responding#interactions-and-bot-users
#[http_component]
fn handle_interaction(req: Request) -> Result<Response> {
    let pub_key = std::env::var(DISCORD_PUB_KEY).expect("Couldn't find Discord Pub Key.");
    let signature = req
        .headers()
        .get("x-signature-ed25519")
        .expect("No signature...");
    let timestamp = req
        .headers()
        .get("x-signature-timestamp")
        .expect("No timestamp...");
    let body = std::str::from_utf8(req.body().as_ref().expect("No body")).expect("Non-utf-8 body");

    let public_key = PublicKey::from_bytes(&hex::decode(pub_key).unwrap()).unwrap();
    let signature = Signature::from_bytes(&hex::decode(signature).unwrap()).unwrap();

    if public_key
        .verify(
            format!(
                "{}{}",
                timestamp.to_str().context("timestamp header to str")?,
                body
            )
            .as_bytes(),
            &signature,
        )
        .is_ok()
    {
        let event = serde_json::from_str::<DiscordInteraction>(body).expect("invalid interaction");
        let address = std::env::var(REDIS_ADDRESS).expect("Couldn't find REDIS addr");

        match event.command_type {
            1 => {
                let mut mitchsaid = DiscordCommand::new("mitchsaid", "Quotes a thing mitch said");
                let input = DiscordOption::new(
                    "quote",
                    "The thing Mitch said",
                    CommandOptionType::String,
                    REQUIRED,
                );
                mitchsaid.add_option(input);
                println!(
                    "{:?}",
                    send_command(event.application_id, mitchsaid).unwrap()
                );
            }
            2 => {
                let data = event.data.as_ref().expect("No options?");
                let quote_option = data.options.get(0).expect("No quote.");
                redis::set(
                    &address,
                    format!("mitchsaid:{}", quote_option.value).as_str(),
                    &[0],
                )
                .expect("Failed to connect to redis.");
                event
                    .reply(format!("Mitch said: '{}'.", quote_option.value))
                    .unwrap();
            }
            _ => {
                panic!("Unknown type.");
            }
        }

        Ok(http::Response::builder()
            .status(200)
            .header("Content-Type", "application/json")
            .body(Some("{\"type\": 1}".into()))?)
    } else {
        Ok(http::Response::builder()
            .status(400)
            .body(Some("Bad Signature".into()))?)
    }
}
