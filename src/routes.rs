use crate::{crypto, delivery, error::AppError, AppState};
use argon2::{password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2};
use axum::{body::Bytes, extract::{Path, State}, http::{HeaderMap, StatusCode}, Json};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

type Result<T> = std::result::Result<T, AppError>;

pub async fn health() -> Json<Value> {
    Json(json!({"status":"ok","build":option_env!("BUILD_SHA").unwrap_or("development")}))
}

pub async fn status(State(state): State<AppState>) -> Result<Json<Value>> {
    let initialized = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM settings").fetch_one(&state.pool).await? > 0;
    Ok(Json(json!({"initialized":initialized})))
}

#[derive(Deserialize)]
pub struct SetupInput { business_name: String, password: String, retention_hours: Option<i64> }

pub async fn setup(State(state): State<AppState>, Json(input): Json<SetupInput>) -> Result<(StatusCode, Json<Value>)> {
    if sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM settings").fetch_one(&state.pool).await? > 0 {
        return Err(AppError::Conflict("This router has already been set up.".into()));
    }
    validate_name(&input.business_name, "Business name")?;
    if input.password.chars().count() < 12 { return Err(AppError::BadRequest("Use an admin password of at least 12 characters.".into())); }
    let retention = input.retention_hours.unwrap_or(72);
    if !(1..=720).contains(&retention) { return Err(AppError::BadRequest("Retention must be between 1 and 720 hours.".into())); }
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default().hash_password(input.password.as_bytes(), &salt)
        .map_err(|_| AppError::Internal("The admin password could not be secured.".into()))?.to_string();
    let webhook_secret = crypto::random_token();
    sqlx::query("INSERT INTO settings (id,business_name,password_hash,webhook_secret,retention_hours,created_at) VALUES (1,?,?,?,?,?)")
        .bind(input.business_name.trim()).bind(password_hash).bind(&webhook_secret).bind(retention).bind(Utc::now().to_rfc3339()).execute(&state.pool).await?;
    let session = create_session(&state).await?;
    Ok((StatusCode::CREATED, Json(json!({"token":session,"webhook_secret":webhook_secret}))))
}

#[derive(Deserialize)]
pub struct LoginInput { password: String }

pub async fn login(State(state): State<AppState>, Json(input): Json<LoginInput>) -> Result<Json<Value>> {
    let hash = sqlx::query_scalar::<_, String>("SELECT password_hash FROM settings WHERE id=1").fetch_optional(&state.pool).await?.ok_or(AppError::NotFound("Set up the router first.".into()))?;
    let parsed = PasswordHash::new(&hash).map_err(|_| AppError::Internal("The stored password is invalid.".into()))?;
    if Argon2::default().verify_password(input.password.as_bytes(), &parsed).is_err() { return Err(AppError::Unauthorized); }
    Ok(Json(json!({"token":create_session(&state).await?})))
}

async fn create_session(state: &AppState) -> Result<String> {
    let token = crypto::random_token();
    sqlx::query("INSERT INTO sessions(token_hash,expires_at,created_at) VALUES(?,?,?)")
        .bind(crypto::hash(&token)).bind((Utc::now()+Duration::days(7)).to_rfc3339()).bind(Utc::now().to_rfc3339()).execute(&state.pool).await?;
    Ok(token)
}

async fn require_auth(state: &AppState, headers: &HeaderMap) -> Result<()> {
    let token = headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).ok_or(AppError::Unauthorized)?;
    let valid = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sessions WHERE token_hash=? AND datetime(expires_at) > datetime('now')")
        .bind(crypto::hash(token)).fetch_one(&state.pool).await? > 0;
    if valid { Ok(()) } else { Err(AppError::Unauthorized) }
}

pub async fn config(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    require_auth(&state, &headers).await?;
    let row = sqlx::query("SELECT business_name, retention_hours, licensed, webhook_secret FROM settings WHERE id=1").fetch_one(&state.pool).await?;
    let secret: String = row.get("webhook_secret");
    let recipient_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM recipients").fetch_one(&state.pool).await?;
    let rule_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rules").fetch_one(&state.pool).await?;
    Ok(Json(json!({
        "business_name":row.get::<String,_>("business_name"),
        "retention_hours":row.get::<i64,_>("retention_hours"),
        "licensed":row.get::<i64,_>("licensed") == 1,
        "webhook_secret_hint":format!("••••••••{}", &secret[secret.len().saturating_sub(6)..]),
        "smtp_configured":state.config.smtp_host.is_some() && state.config.smtp_from.is_some(),
        "recipient_count":recipient_count,"rule_count":rule_count,
        "public_base_url":state.config.public_base_url
    })))
}

#[derive(Deserialize)]
pub struct ConfigInput { business_name: String, retention_hours: i64 }

pub async fn update_config(State(state): State<AppState>, headers: HeaderMap, Json(input): Json<ConfigInput>) -> Result<Json<Value>> {
    require_auth(&state, &headers).await?;
    validate_name(&input.business_name, "Business name")?;
    if !(1..=720).contains(&input.retention_hours) { return Err(AppError::BadRequest("Retention must be between 1 and 720 hours.".into())); }
    sqlx::query("UPDATE settings SET business_name=?, retention_hours=? WHERE id=1").bind(input.business_name.trim()).bind(input.retention_hours).execute(&state.pool).await?;
    Ok(Json(json!({"updated":true})))
}

pub async fn rotate_secret(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    require_auth(&state, &headers).await?;
    let secret = crypto::random_token();
    sqlx::query("UPDATE settings SET webhook_secret=? WHERE id=1").bind(&secret).execute(&state.pool).await?;
    Ok(Json(json!({"webhook_secret":secret,"notice":"Update the sender before its next booking; the previous secret no longer works."})))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Recipient { id: i64, name: String, channel: String, destination: String, consent_confirmed: bool, active: bool }

pub async fn list_recipients(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Vec<Recipient>>> {
    require_auth(&state, &headers).await?;
    Ok(Json(sqlx::query_as("SELECT id,name,channel,destination,consent_confirmed,active FROM recipients ORDER BY name").fetch_all(&state.pool).await?))
}

#[derive(Deserialize)]
pub struct RecipientInput { name: String, channel: String, destination: String, consent_confirmed: bool }

pub async fn create_recipient(State(state): State<AppState>, headers: HeaderMap, Json(input): Json<RecipientInput>) -> Result<(StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    enforce_free_limit(&state, "recipients").await?;
    validate_name(&input.name, "Recipient name")?;
    if !matches!(input.channel.as_str(), "email"|"webhook") { return Err(AppError::BadRequest("Channel must be email or webhook.".into())); }
    if !input.consent_confirmed { return Err(AppError::BadRequest("Confirm this recipient agreed to receive operational notices.".into())); }
    if input.channel == "email" {
        if !input.destination.contains('@') || input.destination.contains(char::is_whitespace) { return Err(AppError::BadRequest("Enter a valid email address.".into())); }
    } else {
        let url = reqwest::Url::parse(&input.destination).map_err(|_| AppError::BadRequest("Enter a complete webhook URL.".into()))?;
        if !matches!(url.scheme(), "http"|"https") { return Err(AppError::BadRequest("Webhook URL must use HTTP or HTTPS.".into())); }
    }
    let result = sqlx::query("INSERT INTO recipients(name,channel,destination,consent_confirmed,created_at) VALUES(?,?,?,?,?)")
        .bind(input.name.trim()).bind(input.channel).bind(input.destination.trim()).bind(input.consent_confirmed).bind(Utc::now().to_rfc3339()).execute(&state.pool).await?;
    Ok((StatusCode::CREATED, Json(json!({"id":result.last_insert_rowid()}))))
}

pub async fn delete_recipient(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<i64>) -> Result<StatusCode> {
    require_auth(&state, &headers).await?;
    let result = sqlx::query("DELETE FROM recipients WHERE id=?").bind(id).execute(&state.pool).await?;
    if result.rows_affected()==0 { Err(AppError::NotFound("Recipient not found.".into())) } else { Ok(StatusCode::NO_CONTENT) }
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Rule { id: i64, match_field: String, match_value: String, recipient_id: i64, recipient_name: String, priority: i64, active: bool }

pub async fn list_rules(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Vec<Rule>>> {
    require_auth(&state, &headers).await?;
    Ok(Json(sqlx::query_as("SELECT x.id,x.match_field,x.match_value,x.recipient_id,r.name recipient_name,x.priority,x.active FROM rules x JOIN recipients r ON r.id=x.recipient_id ORDER BY x.priority,x.id").fetch_all(&state.pool).await?))
}

#[derive(Deserialize)]
pub struct RuleInput { match_field: String, match_value: String, recipient_id: i64, priority: Option<i64> }

pub async fn create_rule(State(state): State<AppState>, headers: HeaderMap, Json(input): Json<RuleInput>) -> Result<(StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    enforce_free_limit(&state, "rules").await?;
    if !matches!(input.match_field.as_str(), "service"|"provider") { return Err(AppError::BadRequest("Match field must be service or provider.".into())); }
    validate_name(&input.match_value, "Match value")?;
    let exists = sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM recipients WHERE id=? AND active=1").bind(input.recipient_id).fetch_one(&state.pool).await? > 0;
    if !exists { return Err(AppError::BadRequest("Choose an active recipient.".into())); }
    let priority = input.priority.unwrap_or(100).clamp(1,999);
    let result = sqlx::query("INSERT INTO rules(match_field,match_value,recipient_id,priority,created_at) VALUES(?,?,?,?,?)")
        .bind(input.match_field).bind(input.match_value.trim()).bind(input.recipient_id).bind(priority).bind(Utc::now().to_rfc3339()).execute(&state.pool).await?;
    Ok((StatusCode::CREATED, Json(json!({"id":result.last_insert_rowid()}))))
}

pub async fn delete_rule(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<i64>) -> Result<StatusCode> {
    require_auth(&state, &headers).await?;
    let result = sqlx::query("DELETE FROM rules WHERE id=?").bind(id).execute(&state.pool).await?;
    if result.rows_affected()==0 { Err(AppError::NotFound("Rule not found.".into())) } else { Ok(StatusCode::NO_CONTENT) }
}

async fn enforce_free_limit(state: &AppState, table: &str) -> Result<()> {
    let licensed = sqlx::query_scalar::<_, i64>("SELECT licensed FROM settings WHERE id=1").fetch_one(&state.pool).await? == 1;
    if licensed { return Ok(()); }
    let query = if table == "rules" { "SELECT COUNT(*) FROM rules" } else { "SELECT COUNT(*) FROM recipients" };
    if sqlx::query_scalar::<_, i64>(query).fetch_one(&state.pool).await? >= 3 { Err(AppError::PaymentRequired) } else { Ok(()) }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BookingInput {
    pub external_id: String,
    pub service: String,
    pub provider: Option<String>,
    pub starts_at: Option<String>,
    pub customer_name: Option<String>,
    pub customer_email: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

pub async fn receive_booking(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> Result<(StatusCode, Json<Value>)> {
    let secret = sqlx::query_scalar::<_, String>("SELECT webhook_secret FROM settings WHERE id=1").fetch_optional(&state.pool).await?.ok_or(AppError::NotFound("Set up the router first.".into()))?;
    let signature = headers.get("x-router-signature").and_then(|v| v.to_str().ok()).ok_or_else(|| AppError::Unauthorized)?;
    if !crypto::verify_signature(&secret, &body, signature) { return Err(AppError::Unauthorized); }
    let booking: BookingInput = serde_json::from_slice(&body).map_err(|_| AppError::BadRequest("Send a valid normalized booking JSON body.".into()))?;
    ingest_booking(&state, booking).await
}

pub async fn test_booking(State(state): State<AppState>, headers: HeaderMap, Json(booking): Json<BookingInput>) -> Result<(StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    ingest_booking(&state, booking).await
}

async fn ingest_booking(state: &AppState, booking: BookingInput) -> Result<(StatusCode, Json<Value>)> {
    validate_booking(&booking)?;
    if let Some(existing) = sqlx::query_scalar::<_, String>("SELECT id FROM bookings WHERE external_id=?").bind(&booking.external_id).fetch_optional(&state.pool).await? {
        return Ok((StatusCode::OK, Json(json!({"accepted":true,"duplicate":true,"booking_id":existing}))));
    }
    let rules = sqlx::query("SELECT x.id,x.match_field,x.match_value,x.recipient_id FROM rules x JOIN recipients r ON r.id=x.recipient_id WHERE x.active=1 AND r.active=1 ORDER BY x.priority,x.id").fetch_all(&state.pool).await?;
    let matched = rules.into_iter().find(|row| {
        let field: String = row.get("match_field");
        let expected: String = row.get("match_value");
        let actual = if field == "service" { Some(booking.service.as_str()) } else { booking.provider.as_deref() };
        actual.is_some_and(|v| v.eq_ignore_ascii_case(expected.trim()))
    });
    let id = Uuid::new_v4().to_string();
    let serialized = serde_json::to_vec(&booking).map_err(|error| AppError::Internal(error.to_string()))?;
    let encrypted = crypto::encrypt(&state.encryption_key, &serialized)?;
    sqlx::query("INSERT INTO bookings(id,external_id,service,provider,starts_at,encrypted_payload,received_at) VALUES(?,?,?,?,?,?,?)")
        .bind(&id).bind(&booking.external_id).bind(booking.service.trim()).bind(booking.provider.as_deref()).bind(booking.starts_at.as_deref()).bind(encrypted).bind(Utc::now().to_rfc3339()).execute(&state.pool).await?;
    if let Some(rule) = matched {
        let ack = crypto::random_token();
        let result = sqlx::query("INSERT INTO notifications(booking_id,recipient_id,rule_id,ack_token,status,created_at) VALUES(?,?,?,?, 'queued', ?)")
            .bind(&id).bind(rule.get::<i64,_>("recipient_id")).bind(rule.get::<i64,_>("id")).bind(&ack).bind(Utc::now().to_rfc3339()).execute(&state.pool).await?;
        let notification_id = result.last_insert_rowid();
        delivery::deliver_notification(state, notification_id).await;
        let status = sqlx::query_scalar::<_,String>("SELECT status FROM notifications WHERE id=?").bind(notification_id).fetch_one(&state.pool).await?;
        Ok((StatusCode::ACCEPTED, Json(json!({"accepted":true,"booking_id":id,"matched":true,"delivery_status":status}))))
    } else {
        Ok((StatusCode::ACCEPTED, Json(json!({"accepted":true,"booking_id":id,"matched":false,"delivery_status":"unmatched"}))))
    }
}

fn validate_booking(input: &BookingInput) -> Result<()> {
    validate_name(&input.external_id, "External ID")?;
    validate_name(&input.service, "Service")?;
    if input.external_id.len()>160 || input.service.len()>160 { return Err(AppError::BadRequest("External ID and service must be 160 characters or fewer.".into())); }
    if let Some(email)=&input.customer_email { if email.len()>254 { return Err(AppError::BadRequest("Customer email is too long.".into())); } }
    Ok(())
}

#[derive(Serialize, sqlx::FromRow)]
pub struct EventRow {
    id: Option<i64>, booking_id: String, service: String, provider: Option<String>, starts_at: Option<String>,
    recipient_name: Option<String>, channel: Option<String>, status: String, attempt_count: i64,
    error: Option<String>, acknowledged_at: Option<String>, created_at: String, purged_at: Option<String>
}

pub async fn list_events(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    require_auth(&state, &headers).await?;
    let events: Vec<EventRow> = sqlx::query_as("SELECT n.id,b.id booking_id,b.service,b.provider,b.starts_at,r.name recipient_name,r.channel,COALESCE(n.status,'unmatched') status,COALESCE(n.attempt_count,0) attempt_count,n.error,n.acknowledged_at,COALESCE(n.created_at,b.received_at) created_at,b.purged_at FROM bookings b LEFT JOIN notifications n ON n.booking_id=b.id LEFT JOIN recipients r ON r.id=n.recipient_id ORDER BY b.received_at DESC LIMIT 100").fetch_all(&state.pool).await?;
    let unmatched = sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM bookings b WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.booking_id=b.id)").fetch_one(&state.pool).await?;
    let received = sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM bookings").fetch_one(&state.pool).await?;
    let delivered = sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM notifications WHERE status IN ('delivered','acknowledged')").fetch_one(&state.pool).await?;
    let acknowledged = sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM notifications WHERE status='acknowledged'").fetch_one(&state.pool).await?;
    Ok(Json(json!({"events":events,"metrics":{"received":received,"delivered":delivered,"acknowledged":acknowledged,"unmatched":unmatched}})))
}

pub async fn retry_event(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<i64>) -> Result<Json<Value>> {
    require_auth(&state, &headers).await?;
    let exists = sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM notifications WHERE id=?").bind(id).fetch_one(&state.pool).await? > 0;
    if !exists { return Err(AppError::NotFound("Notification not found.".into())); }
    sqlx::query("UPDATE notifications SET status='queued',next_attempt_at=NULL,error=NULL WHERE id=? AND status!='acknowledged'").bind(id).execute(&state.pool).await?;
    delivery::deliver_notification(&state,id).await;
    let status=sqlx::query_scalar::<_,String>("SELECT status FROM notifications WHERE id=?").bind(id).fetch_one(&state.pool).await?;
    Ok(Json(json!({"status":status})))
}

pub async fn ack_status(State(state): State<AppState>, Path(token): Path<String>) -> Result<Json<Value>> {
    let row = sqlx::query("SELECT b.service,b.starts_at,n.status,n.acknowledged_at FROM notifications n JOIN bookings b ON b.id=n.booking_id WHERE n.ack_token=?").bind(token).fetch_optional(&state.pool).await?.ok_or(AppError::NotFound("This acknowledgment link is invalid or no longer available.".into()))?;
    Ok(Json(json!({"service":row.get::<String,_>("service"),"starts_at":row.get::<Option<String>,_>("starts_at"),"status":row.get::<String,_>("status"),"acknowledged_at":row.get::<Option<String>,_>("acknowledged_at")})))
}

pub async fn acknowledge(State(state): State<AppState>, Path(token): Path<String>) -> Result<Json<Value>> {
    let now=Utc::now().to_rfc3339();
    let result=sqlx::query("UPDATE notifications SET status='acknowledged',acknowledged_at=?,next_attempt_at=NULL WHERE ack_token=?").bind(&now).bind(token).execute(&state.pool).await?;
    if result.rows_affected()==0 { return Err(AppError::NotFound("This acknowledgment link is invalid or no longer available.".into())); }
    Ok(Json(json!({"acknowledged":true,"acknowledged_at":now})))
}

pub async fn purge_now(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    require_auth(&state,&headers).await?;
    let purged=purge_expired(&state).await?;
    Ok(Json(json!({"purged":purged})))
}

pub async fn purge_expired(state:&AppState)->Result<u64>{
    let retention=sqlx::query_scalar::<_,i64>("SELECT retention_hours FROM settings WHERE id=1").fetch_optional(&state.pool).await?.unwrap_or(72);
    let cutoff=(Utc::now()-Duration::hours(retention)).to_rfc3339();
    Ok(sqlx::query("UPDATE bookings SET encrypted_payload='',purged_at=? WHERE purged_at IS NULL AND received_at < ?").bind(Utc::now().to_rfc3339()).bind(cutoff).execute(&state.pool).await?.rows_affected())
}

#[derive(Deserialize)]
pub struct LicenseInput { token: String }

pub async fn activate_license(State(state): State<AppState>, headers: HeaderMap, Json(input): Json<LicenseInput>) -> Result<Json<Value>> {
    require_auth(&state,&headers).await?;
    if input.token.len()<12 || input.token.len()>2048 { return Err(AppError::BadRequest("Enter the complete license token.".into())); }
    let url=format!("{}/products/service-notification-router/verify",state.config.billing_api_base);
    let response=state.http.get(url).query(&[("license",&input.token)]).send().await.map_err(|_|AppError::BadRequest("The license service could not be reached. Your free routes still work.".into()))?;
    if !response.status().is_success(){return Err(AppError::BadRequest("The license service did not accept that verification request.".into()));}
    let verdict:Value=response.json().await.map_err(|_|AppError::BadRequest("The license service returned an unreadable response.".into()))?;
    let valid=verdict.get("valid").and_then(Value::as_bool).unwrap_or(false);
    if valid {
        let encrypted=crypto::encrypt(&state.encryption_key,input.token.as_bytes())?;
        sqlx::query("UPDATE settings SET licensed=1,license_token_enc=?,license_checked_at=? WHERE id=1").bind(encrypted).bind(Utc::now().to_rfc3339()).execute(&state.pool).await?;
    } else {
        sqlx::query("UPDATE settings SET licensed=0,license_token_enc=NULL,license_checked_at=? WHERE id=1").bind(Utc::now().to_rfc3339()).execute(&state.pool).await?;
    }
    Ok(Json(json!({"valid":valid,"reason":verdict.get("reason").cloned().unwrap_or(json!("invalid"))})))
}

fn validate_name(value:&str,label:&str)->Result<()> {
    let value=value.trim();
    if value.is_empty(){return Err(AppError::BadRequest(format!("{label} is required.")));}
    if value.chars().count()>160{return Err(AppError::BadRequest(format!("{label} must be 160 characters or fewer.")));}
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn booking_validation_rejects_empty_service() {
        let input=BookingInput{external_id:"x".into(),service:" ".into(),provider:None,starts_at:None,customer_name:None,customer_email:None,metadata:Value::Null};
        assert!(validate_booking(&input).is_err());
    }
}
