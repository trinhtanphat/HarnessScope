mod model;
mod validate;

pub use model::{
    CollectorCapability, CollectorDiagnostic, CollectorEnvelope, CollectorEnvelopeKind,
    CollectorManifest, CollectorStartRequest, CollectorStatus, CollectorTarget,
};
pub use validate::{CollectorProtocolError, validate_envelope, validate_manifest};

pub const COLLECTOR_SDK_VERSION: &str = "1";
pub const MAX_ENVELOPE_BYTES: usize = 262_144;
