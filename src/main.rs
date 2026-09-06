mod crypto;
mod delivery;
mod error;
mod routes;

use axum::{
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderName, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::{
    collections::HashMap,
    env,
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    str::FromStr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tower_http::{
    catch_panic::CatchPanicLayer,
    compression::CompressionLayer,
    limit::RequestBodyLimitLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub encryption_key: Arc<[u8; 32]>,
    pub config: Arc<AppConfig>,
    pub http: reqwest::Client,
    pub rate_limits: Arc<Mutex<HashMap<String, RateBucket>>>,
    pub bootstrap_proof: Arc<String>,
    pub demo_workspaces: Arc<Mutex<HashMap<String, Instant>>>,
}

pub struct RateBucket {
    window_started: Instant,
    count: u32,
}

#[derive(Clone)]
pub struct AppConfig {
    pub public_base_url: String,
    pub billing_api_base: String,
    pub smtp_host: Option<String>,
    pub smtp_port: u16,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "service_notification_router=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    let data_dir_supplied = env::var("DATA_DIR").ok();
    let data_dir = PathBuf::from(data_dir_supplied.clone().unwrap_or_else(|| {
        if Path::new("/data").is_dir() {
            "/data".into()
        } else {
            "./data".into()
        }
    }));
    std::fs::create_dir_all(&data_dir)?;
    let legacy_db_path = data_dir.join("router.db");
    let prior_db_path = data_dir.join("router.sqlite3");
    let current_db_path = data_dir.join("router.storage.sqlite3");
    let db_path = if current_db_path.exists() {
        current_db_path
    } else if prior_db_path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > 0)
    {
        prior_db_path
    } else if legacy_db_path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > 0)
    {
        legacy_db_path
    } else {
        current_db_path
    };
    let database_url = format!("sqlite://{}", db_path.display());
    let options = SqliteConnectOptions::from_str(&database_url)?
        .create_if_missing(true)
        .foreign_keys(true)
        // The fleet's private Azure Files mount does not provide SQLite with
        // usable byte-range locks. This VFS is safe because deployment is
        // deliberately bounded to one process and one replica.
        .vfs("unix-none")
        .busy_timeout(Duration::from_secs(30));
    let pool = SqlitePoolOptions::new()
        // Azure Files exposes SQLite through SMB. One connection keeps its
        // file lock semantics predictable and matches the one-replica deploy.
        .max_connections(1)
        .connect_with(options)
        .await?;
    sqlx::migrate!().run(&pool).await?;
    let migration_source = "synchronous";
    let key_path = data_dir.join("router.key");
    let encryption_key_source = if key_path.exists() {
        "persisted"
    } else {
        "generated"
    };
    let encryption_key = crypto::load_or_create_key(&key_path)?;
    let (bootstrap_proof, bootstrap_proof_source) = load_or_create_bootstrap_proof(&data_dir)?;
    let public_base_url_supplied = env::var("PUBLIC_BASE_URL").ok();
    let config = AppConfig {
        public_base_url: public_base_url_supplied
            .clone()
            .unwrap_or_else(|| "https://service-notification-router.sociobot.in".into())
            .trim_end_matches('/')
            .into(),
        billing_api_base: env::var("BILLING_API_BASE")
            .unwrap_or_else(|_| "https://api.sociobot.in/api/v1".into())
            .trim_end_matches('/')
            .into(),
        smtp_host: env::var("SMTP_HOST").ok(),
        smtp_port: env::var("SMTP_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(587),
        smtp_username: env::var("SMTP_USERNAME").ok(),
        smtp_password: env::var("SMTP_PASSWORD").ok(),
        smtp_from: env::var("SMTP_FROM").ok(),
    };
    let state = AppState {
        pool,
        encryption_key: Arc::new(encryption_key),
        config: Arc::new(config),
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("service-notification-router/1.0")
            .build()?,
        rate_limits: Arc::new(Mutex::new(HashMap::new())),
        bootstrap_proof: Arc::new(bootstrap_proof),
        demo_workspaces: Arc::new(Mutex::new(HashMap::new())),
    };
    tracing::info!(
        data_dir_source = if data_dir_supplied.is_some() {
            "supplied"
        } else {
            "default"
        },
        encryption_key_source,
        bootstrap_proof_source,
        migration_source,
        public_base_url_source = if public_base_url_supplied.is_some() {
            "supplied"
        } else {
            "product_default"
        },
        smtp_source = if state.config.smtp_host.is_some() {
            "supplied"
        } else {
            "not_configured"
        },
        "configuration ready"
    );
    spawn_maintenance(state.clone());

    let app = build_app(state, Path::new("frontend/dist"));
    let port = env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!(port, "router listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

pub fn build_app(state: AppState, frontend_dir: &Path) -> Router {
    let index = frontend_dir.join("index.html");
    // Serve known browser entry points directly rather than through ServeDir's
    // not-found handler. That handler preserves a 404 status when it returns
    // an index file, making valid legal and acknowledgment URLs look failed.
    let client_routes = Router::new()
        .route_service("/demo", ServeFile::new(index.clone()))
        .route_service("/setup", ServeFile::new(index.clone()))
        .route_service("/login", ServeFile::new(index.clone()))
        .route_service("/dashboard", ServeFile::new(index.clone()))
        .route_service("/recipients", ServeFile::new(index.clone()))
        .route_service("/rules", ServeFile::new(index.clone()))
        .route_service("/test", ServeFile::new(index.clone()))
        .route_service("/settings", ServeFile::new(index.clone()))
        .route_service("/privacy", ServeFile::new(index.clone()))
        .route_service("/terms", ServeFile::new(index.clone()))
        .route_service("/ack/{token}", ServeFile::new(index.clone()));
    let api = Router::new()
        .route("/health", get(routes::health))
        .route("/api/status", get(routes::status))
        .route("/api/demo", post(routes::start_demo))
        .route(
            "/api/demo/{id}",
            get(routes::get_demo).delete(routes::leave_demo),
        )
        .route("/api/demo/{id}/reset", post(routes::reset_demo))
        .route("/api/setup", post(routes::setup))
        .route("/api/login", post(routes::login))
        .route(
            "/api/config",
            get(routes::config).patch(routes::update_config),
        )
        .route("/api/secret/rotate", post(routes::rotate_secret))
        .route(
            "/api/recipients",
            get(routes::list_recipients).post(routes::create_recipient),
        )
        .route(
            "/api/recipients/{id}",
            axum::routing::delete(routes::delete_recipient),
        )
        .route(
            "/api/rules",
            get(routes::list_rules).post(routes::create_rule),
        )
        .route(
            "/api/rules/{id}",
            axum::routing::delete(routes::delete_rule),
        )
        .route("/api/bookings", post(routes::receive_booking))
        .route("/api/bookings/test", post(routes::test_booking))
        .route("/api/events", get(routes::list_events))
        .route("/api/events/{id}/retry", post(routes::retry_event))
        .route(
            "/api/ack/{token}",
            get(routes::ack_status).post(routes::acknowledge),
        )
        .route("/api/purge", post(routes::purge_now))
        .route("/api/license", post(routes::activate_license));

    Router::new()
        .merge(api)
        .merge(client_routes)
        .fallback_service(
            ServeDir::new(frontend_dir)
                .not_found_service(ServeFile::new(frontend_dir.join("404.html"))),
        )
        .with_state(state.clone())
        .layer(axum::middleware::from_fn(cache_headers))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            rate_limit,
        ))
        .layer(CatchPanicLayer::new())
        .layer(RequestBodyLimitLayer::new(256 * 1024))
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::if_not_present(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::if_not_present(header::REFERRER_POLICY, HeaderValue::from_static("same-origin")))
        .layer(SetResponseHeaderLayer::if_not_present(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY")))
        .layer(SetResponseHeaderLayer::if_not_present(HeaderName::from_static("permissions-policy"), HeaderValue::from_static("camera=(), microphone=(), geolocation=()")))
        .layer(SetResponseHeaderLayer::if_not_present(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' https://api.sociobot.in https://pilot-api.sociobot.in; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://api.sociobot.in")))
        .layer(TraceLayer::new_for_http())
}

async fn rate_limit(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let path = request.uri().path();
    if path == "/health" {
        return next.run(request).await;
    }
    let (class, limit) = match (request.method(), path) {
        (_, "/api/login" | "/api/setup") => ("auth", 10),
        (_, "/api/bookings") => ("intake", 120),
        (&Method::GET, _) => ("read", 120),
        _ => ("write", 40),
    };
    let peer = forwarded_client_ip(&request).unwrap_or_else(|| "local-test".into());
    let key = format!("{peer}:{class}");
    let blocked = {
        let mut buckets = state.rate_limits.lock().expect("rate limit lock");
        if buckets.len() > 10_000 {
            buckets.retain(|_, bucket| bucket.window_started.elapsed() < Duration::from_secs(60));
        }
        let bucket = buckets.entry(key).or_insert(RateBucket {
            window_started: Instant::now(),
            count: 0,
        });
        if bucket.window_started.elapsed() >= Duration::from_secs(60) {
            bucket.window_started = Instant::now();
            bucket.count = 0;
        }
        bucket.count += 1;
        bucket.count > limit
    };
    if blocked {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(header::RETRY_AFTER, "60")],
            axum::Json(serde_json::json!({"error":"Too many requests. Try again in one minute."})),
        )
            .into_response();
    }
    next.run(request).await
}

fn forwarded_client_ip(request: &Request) -> Option<String> {
    request
        .headers()
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .and_then(|value| value.parse::<IpAddr>().ok())
        .map(|value| value.to_string())
        .or_else(|| {
            request
                .extensions()
                .get::<ConnectInfo<SocketAddr>>()
                .map(|value| value.0.ip().to_string())
        })
}

fn load_or_create_bootstrap_proof(data_dir: &Path) -> anyhow::Result<(String, &'static str)> {
    let path = data_dir.join("router.setup-code");
    let (proof, source) = if let Ok(value) = env::var("SETUP_PROOF") {
        (value, "supplied")
    } else if path.exists() {
        (
            std::fs::read_to_string(&path)?.trim().to_owned(),
            "persisted",
        )
    } else {
        (crypto::random_token(), "generated")
    };
    if proof.len() < 20 {
        anyhow::bail!("setup proof must contain at least 20 characters");
    }
    if source == "supplied" || !path.exists() {
        std::fs::write(&path, proof.as_bytes())?;
    }
    crypto::restrict_permissions(&path)?;
    Ok((proof, source))
}

async fn cache_headers(request: Request<Body>, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    let value = if path.starts_with("/api/") || path == "/health" {
        "no-store"
    } else if path.starts_with("/assets/index-") {
        "public, max-age=31536000, immutable"
    } else if path.starts_with("/assets/") || path == "/mark.svg" {
        "public, max-age=604800"
    } else {
        "no-cache"
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    response
}

fn spawn_maintenance(state: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(30));
        // `interval` ticks immediately once. Consume that tick so startup
        // schema work and the first maintenance pass never overlap.
        tick.tick().await;
        loop {
            tick.tick().await;
            if let Err(error) = routes::purge_expired(&state).await {
                tracing::warn!(%error, "retention purge failed");
            }
            if let Err(error) = routes::refresh_license_if_due(&state).await {
                tracing::warn!(%error, "license refresh deferred");
            }
            let ids = sqlx::query_scalar::<_, i64>("SELECT id FROM notifications WHERE status IN ('queued','failed') AND attempt_count < 8 AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now')) ORDER BY id LIMIT 20")
                .fetch_all(&state.pool).await.unwrap_or_default();
            for id in ids {
                delivery::deliver_notification(&state, id).await;
            }
        }
    });
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install signal handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
    tracing::info!("shutdown requested");
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use serde_json::{json, Value};
    use tempfile::TempDir;
    use tower::ServiceExt;

    async fn test_app() -> (Router, AppState, TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let options = SqliteConnectOptions::from_str(&format!(
            "sqlite://{}",
            dir.path().join("test.db").display()
        ))
        .unwrap()
        .create_if_missing(true)
        .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let state = AppState {
            pool,
            encryption_key: Arc::new([4u8; 32]),
            config: Arc::new(AppConfig {
                public_base_url: "http://localhost".into(),
                billing_api_base: "http://localhost".into(),
                smtp_host: None,
                smtp_port: 587,
                smtp_username: None,
                smtp_password: None,
                smtp_from: None,
            }),
            http: reqwest::Client::new(),
            rate_limits: Arc::new(Mutex::new(HashMap::new())),
            bootstrap_proof: Arc::new("test-bootstrap-proof-123456789".into()),
            demo_workspaces: Arc::new(Mutex::new(HashMap::new())),
        };
        (build_app(state.clone(), dir.path()), state, dir)
    }

    async fn json_body(response: axum::response::Response) -> Value {
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
    }

    #[tokio::test]
    async fn public_client_routes_return_index_with_http_ok() {
        let (app, _state, dir) = test_app().await;
        std::fs::write(
            dir.path().join("index.html"),
            "<!doctype html><html><head><title>Router</title></head><body><main>Client shell</main></body></html>",
        )
        .unwrap();

        for path in [
            "/demo",
            "/setup",
            "/login",
            "/dashboard",
            "/recipients",
            "/rules",
            "/test",
            "/settings",
            "/privacy",
            "/terms",
            "/ack/a-valid-client-token",
        ] {
            let response = app
                .clone()
                .oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                StatusCode::OK,
                "{path} must be a successful document route"
            );
            let body = response.into_body().collect().await.unwrap().to_bytes();
            assert!(std::str::from_utf8(&body).unwrap().contains("Client shell"));
        }
    }

    #[tokio::test]
    async fn health_returns_the_exact_compiled_build_identity() {
        let (app, _state, _dir) = test_app().await;
        let response = app
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["status"], "ok");
        assert_eq!(
            body["build"],
            option_env!("BUILD_SHA").unwrap_or("development"),
            "/health must expose the compile-time build identity exactly"
        );
    }

    #[tokio::test]
    async fn setup_route_and_signed_booking_flow() {
        let (app, state, _dir) = test_app().await;
        let setup = app.clone().oneshot(Request::post("/api/setup").header("content-type","application/json").body(Body::from(json!({"business_name":"Harbor Clinic","password":"correct horse battery","retention_hours":24,"setup_proof":"test-bootstrap-proof-123456789"}).to_string())).unwrap()).await.unwrap();
        assert_eq!(setup.status(), StatusCode::CREATED);
        let setup_json = json_body(setup).await;
        let token = setup_json["token"].as_str().unwrap();
        let secret = setup_json["webhook_secret"].as_str().unwrap();
        let auth = format!("Bearer {token}");

        let recipient = app.clone().oneshot(Request::post("/api/recipients").header("authorization",&auth).header("content-type","application/json").body(Body::from(json!({"name":"Front desk","channel":"email","destination":"desk@example.com","consent_confirmed":true}).to_string())).unwrap()).await.unwrap();
        assert_eq!(recipient.status(), StatusCode::CREATED);
        let recipient_id = json_body(recipient).await["id"].as_i64().unwrap();
        let rule = app.clone().oneshot(Request::post("/api/rules").header("authorization",&auth).header("content-type","application/json").body(Body::from(json!({"match_field":"service","match_value":"Dental cleaning","recipient_id":recipient_id,"priority":10}).to_string())).unwrap()).await.unwrap();
        assert_eq!(rule.status(), StatusCode::CREATED);

        let booking = json!({"external_id":"apt-100","service":"Dental cleaning","provider":"Dr. Rivera","starts_at":"2026-08-28T09:30:00Z","customer_name":"A. Patient","customer_email":"patient@example.com","metadata":{}}).to_string();
        let signature = crate::crypto::sign(secret, booking.as_bytes());
        let received = app
            .clone()
            .oneshot(
                Request::post("/api/bookings")
                    .header("content-type", "application/json")
                    .header("x-router-signature", signature)
                    .body(Body::from(booking))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(received.status(), StatusCode::ACCEPTED);
        let received_json = json_body(received).await;
        assert_eq!(received_json["matched"], true);
        assert_eq!(received_json["delivery_status"], "failed");

        let ack = sqlx::query_scalar::<_, String>("SELECT ack_token FROM notifications LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        let acknowledged = app
            .oneshot(
                Request::post(format!("/api/ack/{ack}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(acknowledged.status(), StatusCode::OK);
        let stored = sqlx::query_scalar::<_, String>("SELECT status FROM notifications LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(stored, "acknowledged");
    }

    #[tokio::test]
    async fn setup_requires_the_private_bootstrap_proof() {
        let (app, _state, _dir) = test_app().await;
        let response = app
            .oneshot(
                Request::post("/api/setup")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "business_name":"Harbor Clinic",
                            "password":"correct horse battery",
                            "retention_hours":24,
                            "setup_proof":"public-visitor-does-not-have-this"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn demo_is_isolated_from_the_sqlite_workspace() {
        let (app, state, _dir) = test_app().await;
        let before = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM bookings")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        let started = app
            .clone()
            .oneshot(
                Request::post("/api/demo")
                    .header("x-forwarded-for", "203.0.113.40")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(started.status(), StatusCode::CREATED);
        let body = json_body(started).await;
        assert_eq!(body["sample"]["events"].as_array().unwrap().len(), 3);
        assert_eq!(body["sample"]["metrics"]["received"], 3);
        let workspace = body["workspace_id"].as_str().unwrap();
        let left = app
            .clone()
            .oneshot(
                Request::delete(format!("/api/demo/{workspace}"))
                    .header("x-forwarded-for", "203.0.113.40")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(left.status(), StatusCode::NO_CONTENT);
        let expired = app
            .clone()
            .oneshot(
                Request::get(format!("/api/demo/{workspace}"))
                    .header("x-forwarded-for", "203.0.113.40")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(expired.status(), StatusCode::NOT_FOUND);
        let after = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM bookings")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(
            before, after,
            "demo requests must not read or write real booking rows"
        );
    }

    #[tokio::test]
    async fn forwarded_clients_receive_independent_allowances_and_retry_after() {
        let (app, _state, _dir) = test_app().await;
        for _ in 0..120 {
            let response = app
                .clone()
                .oneshot(
                    Request::get("/api/status")
                        .header("x-forwarded-for", "203.0.113.10, 10.0.0.4")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
        }
        let blocked = app
            .clone()
            .oneshot(
                Request::get("/api/status")
                    .header("x-forwarded-for", "203.0.113.10, 10.0.0.4")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(blocked.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(blocked.headers().get(header::RETRY_AFTER).unwrap(), "60");

        let other_client = app
            .oneshot(
                Request::get("/api/status")
                    .header("x-forwarded-for", "203.0.113.11, 10.0.0.4")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(other_client.status(), StatusCode::OK);
    }
}
