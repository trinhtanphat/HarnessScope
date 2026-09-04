use harnesscope_collector_sdk::CollectorDiagnostic;
use harnesscope_collectors::CollectorHandle;
use harnesscope_core::AppServices;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct CollectorInstance {
    pub collector_id: String,
    pub session_id: String,
    pub handle: Arc<CollectorHandle>,
    pub diagnostics: Arc<Mutex<Vec<CollectorDiagnostic>>>,
}

pub struct DesktopState {
    services: Arc<Mutex<AppServices>>,
    collectors: Mutex<HashMap<String, CollectorInstance>>,
}

impl DesktopState {
    pub fn new(services: AppServices) -> Self {
        Self {
            services: Arc::new(Mutex::new(services)),
            collectors: Mutex::new(HashMap::new()),
        }
    }

    pub fn with_services<T>(&self, operation: impl FnOnce(&AppServices) -> T) -> Result<T, ()> {
        self.services
            .lock()
            .map(|services| operation(&services))
            .map_err(|_| ())
    }

    pub fn services_arc(&self) -> Arc<Mutex<AppServices>> {
        Arc::clone(&self.services)
    }

    pub fn collector(&self, instance_id: &str) -> Result<Option<CollectorInstance>, ()> {
        self.collectors
            .lock()
            .map(|collectors| collectors.get(instance_id).cloned())
            .map_err(|_| ())
    }

    pub fn insert_collector(
        &self,
        instance_id: String,
        instance: CollectorInstance,
    ) -> Result<(), ()> {
        let mut collectors = self.collectors.lock().map_err(|_| ())?;
        if collectors.contains_key(&instance_id) {
            return Err(());
        }
        collectors.insert(instance_id, instance);
        Ok(())
    }
}
