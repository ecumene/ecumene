pub mod fogo_date {
    use chrono::{DateTime, NaiveDate, Utc};
    use serde::{self, Deserialize, Deserializer, Serializer};

    pub const FORMAT: &'static str = "%Y-%m-%d";

    pub fn fmt_date(date: &DateTime<Utc>) -> String {
        format!("{}", date.format(FORMAT))
    }

    pub fn serialize<S>(date: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let s = fmt_date(date);
        serializer.serialize_str(&s)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<DateTime<Utc>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        NaiveDate::parse_from_str(&s, "%Y-%m-%d")
            .map(|val| DateTime::<Utc>::from_utc(val.and_hms(0, 0, 0), Utc))
            .map_err(serde::de::Error::custom)
    }
}

pub mod proper_date {
    use chrono::{DateTime, TimeZone, Utc};
    use serde::{self, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(date: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&s)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<DateTime<Utc>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        DateTime<UTC>::from_str(&s).map_err(serde::de::Error::custom)
    }
}
