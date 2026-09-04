use crate::{
    COLLECTOR_SDK_VERSION, CollectorEnvelope, CollectorEnvelopeKind, CollectorManifest,
    MAX_ENVELOPE_BYTES,
};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum CollectorProtocolError {
    #[error("COLLECTOR_PROTOCOL_ERROR")]
    Protocol,
    #[error("COLLECTOR_SEQUENCE_ERROR")]
    Sequence,
}

fn valid_segment(segment: &str) -> bool {
    let mut chars = segment.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_alphanumeric()
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn valid_collector_id(id: &str) -> bool {
    let segments = id.split('.').collect::<Vec<_>>();
    segments.len() >= 3 && segments.iter().all(|segment| valid_segment(segment))
}

pub fn validate_manifest(manifest: &CollectorManifest) -> Result<(), CollectorProtocolError> {
    if manifest.sdk_version != COLLECTOR_SDK_VERSION
        || !valid_collector_id(&manifest.id)
        || manifest.name.trim().is_empty()
        || manifest.version.trim().is_empty()
        || manifest.platforms.is_empty()
        || manifest.content_capture != "unsupported"
    {
        return Err(CollectorProtocolError::Protocol);
    }
    Ok(())
}

pub fn validate_envelope(
    previous_sequence: Option<u64>,
    envelope: &CollectorEnvelope,
) -> Result<(), CollectorProtocolError> {
    if envelope.sdk_version != COLLECTOR_SDK_VERSION
        || !valid_collector_id(&envelope.collector_id)
        || envelope.instance_id.trim().is_empty()
    {
        return Err(CollectorProtocolError::Protocol);
    }

    if previous_sequence.is_some_and(|previous| envelope.sequence <= previous) {
        return Err(CollectorProtocolError::Sequence);
    }

    let shape_valid = match envelope.kind {
        CollectorEnvelopeKind::Event => envelope.event.is_some() && envelope.diagnostic.is_none(),
        CollectorEnvelopeKind::Diagnostic => {
            envelope.event.is_none() && envelope.diagnostic.is_some()
        }
        CollectorEnvelopeKind::Heartbeat | CollectorEnvelopeKind::Completed => {
            envelope.event.is_none() && envelope.diagnostic.is_none()
        }
    };
    if !shape_valid {
        return Err(CollectorProtocolError::Protocol);
    }

    let bytes = serde_json::to_vec(envelope).map_err(|_| CollectorProtocolError::Protocol)?;
    if bytes.len() > MAX_ENVELOPE_BYTES {
        return Err(CollectorProtocolError::Protocol);
    }

    Ok(())
}
