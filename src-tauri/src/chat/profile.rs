// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Free Domain Name contributors

//! Optional, locally persisted profile fields.
//!
//! There is no account and no server-side profile store. The fields are shared
//! only when the user turns on "show profile in rooms"; the signed card travels
//! to the room like a message and is kept in memory for the session.

use serde::{Deserialize, Serialize};

pub const MAX_DESCRIPTION_CHARS: usize = 160;
pub const MAX_GENDER_CHARS: usize = 32;
pub const MAX_CITY_CHARS: usize = 48;
pub const AGE_BANDS: [&str; 7] = [
    "18-24",
    "25-34",
    "35-44",
    "45-54",
    "55-64",
    "65+",
    "prefer not to say",
];

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Profile {
    pub description: String,
    pub gender: String,
    pub age_band: String,
    pub country: String,
    pub city: String,
}

impl Profile {
    pub fn validate(&self) -> Result<(), String> {
        if self.description.chars().count() > MAX_DESCRIPTION_CHARS {
            return Err(format!(
                "description is longer than {MAX_DESCRIPTION_CHARS} characters"
            ));
        }
        if self.city.chars().count() > MAX_CITY_CHARS {
            return Err(format!("city is longer than {MAX_CITY_CHARS} characters"));
        }
        if self.gender.chars().count() > MAX_GENDER_CHARS {
            return Err(format!(
                "gender is longer than {MAX_GENDER_CHARS} characters"
            ));
        }
        if !self.age_band.is_empty() && !AGE_BANDS.contains(&self.age_band.as_str()) {
            return Err("unknown age band".to_string());
        }
        if !self.country.is_empty()
            && (self.country.len() != 2
                || !self
                    .country
                    .chars()
                    .all(|character| character.is_ascii_alphabetic()))
        {
            return Err("country must be a two-letter ISO code".to_string());
        }
        Ok(())
    }

    pub fn is_empty(&self) -> bool {
        self.description.trim().is_empty()
            && self.gender.trim().is_empty()
            && self.age_band.trim().is_empty()
            && self.country.trim().is_empty()
            && self.city.trim().is_empty()
    }

    /// Trims the free-text fields and uppercases an ISO country code.
    pub fn normalized(&self) -> Self {
        Self {
            description: self.description.trim().to_string(),
            gender: self.gender.trim().to_string(),
            age_band: self.age_band.trim().to_string(),
            country: self.country.trim().to_ascii_uppercase(),
            city: self.city.trim().to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_known_age_bands_and_iso_country() {
        let profile = Profile {
            description: "hello".to_string(),
            gender: "prefer not to say".to_string(),
            age_band: "25-34".to_string(),
            country: "de".to_string(),
            city: "Berlin".to_string(),
        };
        assert!(profile.validate().is_ok());
        assert_eq!(profile.normalized().country, "DE");
    }

    #[test]
    fn rejects_bad_fields() {
        assert!(Profile {
            age_band: "17".to_string(),
            ..Profile::default()
        }
        .validate()
        .is_err());
        assert!(Profile {
            country: "DEU".to_string(),
            ..Profile::default()
        }
        .validate()
        .is_err());
        assert!(Profile {
            description: "x".repeat(MAX_DESCRIPTION_CHARS + 1),
            ..Profile::default()
        }
        .validate()
        .is_err());
    }
}
