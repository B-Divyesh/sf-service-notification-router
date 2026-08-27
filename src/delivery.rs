use crate::{crypto, routes::BookingInput, AppState};
use chrono::{Duration, Utc};
use lettre::{message::Mailbox, transport::smtp::authentication::Credentials, AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde_json::json;
use sqlx::Row;

pub async fn deliver_notification(state: &AppState, notification_id: i64) {
    if let Err(error) = deliver(state, notification_id).await {
        tracing::warn!(notification_id, %error, "notification delivery failed");
        let attempts = sqlx::query_scalar::<_, i64>("SELECT attempt_count FROM notifications WHERE id = ?")
            .bind(notification_id).fetch_optional(&state.pool).await.ok().flatten().unwrap_or(1);
        let delay_minutes = match attempts { 0..=1 => 1, 2 => 5, 3 => 30, 4 => 120, _ => 360 };
        let next = (Utc::now() + Duration::minutes(delay_minutes)).to_rfc3339();
        let _ = sqlx::query("UPDATE notifications SET status='failed', error=?, next_attempt_at=? WHERE id=?")
            .bind(truncate_error(&error.to_string())).bind(next).bind(notification_id).execute(&state.pool).await;
    }
}

async fn deliver(state: &AppState, notification_id: i64) -> anyhow::Result<()> {
    let row = sqlx::query("SELECT n.ack_token, n.status, b.encrypted_payload, b.service, b.provider, b.starts_at, r.name, r.channel, r.destination, s.webhook_secret, s.business_name FROM notifications n JOIN bookings b ON b.id=n.booking_id JOIN recipients r ON r.id=n.recipient_id JOIN settings s ON s.id=1 WHERE n.id=?")
        .bind(notification_id).fetch_one(&state.pool).await?;
    if row.get::<String, _>("status") == "acknowledged" { return Ok(()); }
    sqlx::query("UPDATE notifications SET attempt_count=attempt_count+1, last_attempt_at=?, error=NULL WHERE id=?")
        .bind(Utc::now().to_rfc3339()).bind(notification_id).execute(&state.pool).await?;
    let encrypted: String = row.get("encrypted_payload");
    if encrypted.is_empty() { anyhow::bail!("booking details have already been purged"); }
    let payload: BookingInput = serde_json::from_slice(&crypto::decrypt(&state.encryption_key, &encrypted)?)?;
    let ack_token: String = row.get("ack_token");
    let ack_url = format!("{}/ack/{}", state.config.public_base_url, ack_token);
    let channel: String = row.get("channel");
    let destination: String = row.get("destination");
    let business_name: String = row.get("business_name");

    let response_code = if channel == "webhook" {
        let outgoing = json!({
            "event": "booking.routed",
            "booking": payload,
            "recipient": row.get::<String, _>("name"),
            "acknowledgment_url": ack_url
        });
        let bytes = serde_json::to_vec(&outgoing)?;
        let secret: String = row.get("webhook_secret");
        let response = state.http.post(&destination)
            .header("content-type", "application/json")
            .header("x-router-signature", crypto::sign(&secret, &bytes))
            .body(bytes).send().await?;
        let status = response.status();
        if !status.is_success() { anyhow::bail!("recipient webhook returned HTTP {}", status.as_u16()); }
        status.as_u16() as i64
    } else {
        send_email(state, &business_name, &destination, &payload, &ack_url).await?;
        250
    };
    sqlx::query("UPDATE notifications SET status='delivered', response_code=?, error=NULL, next_attempt_at=NULL WHERE id=?")
        .bind(response_code).bind(notification_id).execute(&state.pool).await?;
    tracing::info!(notification_id, channel, "notification delivered");
    Ok(())
}

async fn send_email(state: &AppState, business: &str, destination: &str, booking: &BookingInput, ack_url: &str) -> anyhow::Result<()> {
    let host = state.config.smtp_host.as_deref().ok_or_else(|| anyhow::anyhow!("SMTP is not configured; set SMTP_HOST and SMTP_FROM"))?;
    let from: Mailbox = state.config.smtp_from.as_deref().ok_or_else(|| anyhow::anyhow!("SMTP_FROM is not configured"))?.parse()?;
    let to: Mailbox = destination.parse()?;
    let starts = booking.starts_at.as_deref().unwrap_or("Time not supplied");
    let provider = booking.provider.as_deref().unwrap_or("Not supplied");
    let customer = booking.customer_name.as_deref().unwrap_or("Customer name not supplied");
    let body = format!("A booking has been routed to you by {business}.\n\nService: {}\nProvider: {provider}\nStarts: {starts}\nCustomer: {customer}\n\nAcknowledge: {ack_url}\n\nThis is an operational booking notice, not a marketing message.", booking.service);
    let email = Message::builder().from(from).to(to).subject(format!("Booking to coordinate: {}", booking.service)).body(body)?;
    let mut builder = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)?.port(state.config.smtp_port);
    if let (Some(user), Some(pass)) = (&state.config.smtp_username, &state.config.smtp_password) {
        builder = builder.credentials(Credentials::new(user.clone(), pass.clone()));
    }
    builder.build().send(email).await?;
    Ok(())
}

fn truncate_error(value: &str) -> String { value.chars().take(240).collect() }

