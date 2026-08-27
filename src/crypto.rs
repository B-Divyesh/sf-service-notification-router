use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

pub fn load_or_create_key(path: &Path) -> anyhow::Result<[u8; 32]> {
    if let Ok(bytes) = fs::read(path) {
        return bytes.try_into().map_err(|_| anyhow::anyhow!("encryption key must be 32 bytes"));
    }
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    fs::write(path, key)?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(key)
}

pub fn encrypt(key: &[u8; 32], value: &[u8]) -> anyhow::Result<String> {
    let cipher = Aes256Gcm::new_from_slice(key).unwrap();
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher.encrypt(Nonce::from_slice(&nonce), value)
        .map_err(|_| anyhow::anyhow!("encryption failed"))?;
    let mut out = nonce.to_vec();
    out.extend(encrypted);
    Ok(URL_SAFE_NO_PAD.encode(out))
}

pub fn decrypt(key: &[u8; 32], value: &str) -> anyhow::Result<Vec<u8>> {
    let bytes = URL_SAFE_NO_PAD.decode(value)?;
    if bytes.len() < 13 { anyhow::bail!("invalid encrypted value"); }
    let (nonce, encrypted) = bytes.split_at(12);
    Aes256Gcm::new_from_slice(key).unwrap().decrypt(Nonce::from_slice(nonce), encrypted)
        .map_err(|_| anyhow::anyhow!("decryption failed"))
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn hash(value: &str) -> String { hex::encode(Sha256::digest(value.as_bytes())) }

pub fn verify_signature(secret: &str, body: &[u8], signature: &str) -> bool {
    let supplied = signature.strip_prefix("sha256=").unwrap_or(signature);
    let Ok(bytes) = hex::decode(supplied) else { return false; };
    let Ok(mut mac) = <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()) else { return false; };
    mac.update(body);
    mac.verify_slice(&bytes).is_ok()
}

pub fn sign(secret: &str, body: &[u8]) -> String {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body);
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}

