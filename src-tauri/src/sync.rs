//! Sync of the shared purchase base on launch:
//!  - the GitHub base is merged with the local one and with your own purchases;
//!  - your new purchases go to the shared-base server (a Cloudflare Worker, worker/worker.js).
//! The Worker is the one check on what enters the shared base; the page writes own purchases without free text.
use crate::server::write_atomic;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::time::Duration;

const BASE_REMOTE: &str = "https://raw.githubusercontent.com/neverh8me/abi-merchant-helper/main/library/purchases.json";
const WORKER: &str = "https://abi-kaluvan.kaluvan-tools.workers.dev/submit";
const BATCH: usize = 25; // the Worker accepts no more per request

#[derive(Serialize)]
pub struct Summary {
    pub online: bool,
    pub total: usize,
    pub sent: usize,
}

/// The same key the Worker and the page use: time | item | price.
fn key(e: &Value) -> String {
    format!("{}|{}|{}", e["t"], e["itemId"], e["price"])
}

fn list(text: &str) -> Vec<Value> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Array(a)) => a,
        Ok(mut v) => v["purchases"].as_array_mut().map(std::mem::take).unwrap_or_default(),
        Err(_) => vec![],
    }
}

fn read(file: &Path) -> Vec<Value> {
    std::fs::read_to_string(file).map(|t| list(&t)).unwrap_or_default()
}

/// One entry per key (a later list wins), oldest first.
fn merge(lists: [&[Value]; 3]) -> Vec<Value> {
    let mut map = BTreeMap::new();
    for e in lists.into_iter().flatten().filter(|e| e["t"].as_f64().is_some_and(|t| t > 0.0)) {
        map.insert(key(e), e.clone());
    }
    let mut all: Vec<Value> = map.into_values().collect();
    all.sort_by(|a, b| a["t"].as_f64().partial_cmp(&b["t"].as_f64()).unwrap());
    all
}

pub async fn run(ui: &Path, data: &Path) -> Result<Summary, String> {
    let base_file = data.join("library").join("purchases.json");
    let sent_file = data.join(".purchases-sent.json");
    let local = if base_file.is_file() { read(&base_file) } else { read(&ui.join("library").join("purchases.json")) };
    let mine = read(&data.join("purchases.mine.json"));
    let http = reqwest::Client::builder().user_agent("abi-merchant-helper-sync").timeout(Duration::from_secs(15)).build().map_err(|e| e.to_string())?;

    // 404: there is no base on GitHub yet (still online); anything else: offline
    let (remote, online) = match http.get(BASE_REMOTE).timeout(Duration::from_secs(6)).send().await {
        Ok(r) if r.status().is_success() => (list(&r.text().await.unwrap_or_default()), true),
        Ok(r) => (vec![], r.status() == 404),
        Err(_) => (vec![], false),
    };
    let merged = merge([&remote, &local, &mine]);

    let mut sent_now = 0;
    if online {
        // whatever was already sent or is already on GitHub is not sent again
        let mut sent: HashSet<String> = std::fs::read_to_string(&sent_file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        sent.extend(remote.iter().map(key));
        let todo: Vec<&Value> = mine.iter().filter(|e| !sent.contains(&key(e))).collect();
        for chunk in todo.chunks(BATCH) {
            let reply = match http.post(WORKER).json(&json!({ "purchases": chunk })).send().await {
                Ok(r) if r.status().is_success() => r.json::<Value>().await.unwrap_or_default(),
                _ => break, // rate limit or the server is unavailable: the rest goes next time
            };
            // An older Worker only takes purchases with a sound and does not list what it accepted:
            // the ones without a sound stay unsent until it is updated, instead of being lost.
            let old_worker = reply.get("accepted").is_none();
            for e in chunk.iter().filter(|e| !old_worker || !e["soundId"].is_null()) {
                sent.insert(key(e));
                sent_now += 1;
            }
        }
        let keys: Vec<&String> = sent.iter().collect();
        write_atomic(&sent_file, serde_json::to_string(&keys).unwrap().as_bytes()).map_err(|e| e.to_string())?;
    }
    if merged.len() != local.len() || !base_file.is_file() {
        write_atomic(&base_file, serde_json::to_string(&json!({ "purchases": merged })).unwrap().as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(Summary { online, total: merged.len(), sent: sent_now })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_by_key_oldest_first() {
        let a = list(r#"{"purchases":[{"t":2,"itemId":5,"price":100},{"t":1,"itemId":5,"price":100}]}"#);
        let b = list(r#"[{"t":2,"itemId":5,"price":100,"label":"x"},{"t":0,"itemId":1,"price":1}]"#);
        let m = merge([&a, &b, &[]]);
        assert_eq!(m.len(), 2);
        assert_eq!(m[0]["t"], 1);
        assert_eq!(m[1]["label"], "x"); // the later list wins
        assert_eq!(key(&m[0]), "1|5|100");
        assert!(list("not json").is_empty());
    }
}
