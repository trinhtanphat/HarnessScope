use harnesscope_core::AppServices;
use std::sync::Mutex;

pub struct DesktopState {
    services: Mutex<AppServices>,
}

impl DesktopState {
    pub fn new(services: AppServices) -> Self {
        Self {
            services: Mutex::new(services),
        }
    }

    pub fn with_services<T>(&self, operation: impl FnOnce(&AppServices) -> T) -> Result<T, ()> {
        self.services.lock().map(|services| operation(&services)).map_err(|_| ())
    }
}
